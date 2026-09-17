import request from "supertest";
import {
  TestApp,
  createTestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
  csrfToken,
  createPropertyRow,
  seedSignalSnapshot,
} from "../test-utils/e2e-fixtures";

describe("History API (workspace-scoped, no separate table)", () => {
  // ONE expensive setup per app lifetime (sync 1/5min, ingest 10/min):
  // fix1 dismissed + fix2 measured, shared by every test through HTTP.
  let testApp: TestApp;
  let shared: { agent: any; workspaceId: string; propertyId: string; siteUrl: string; fix1: string; fix2: string };

  beforeAll(async () => {
    testApp = await createTestApp();
    await truncateAll(testApp.prisma);
    const { agent, workspaceId } = await signupAgent(testApp.app, "hist");
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/sync`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/properties`).expect(200);
    const prop = list.body.properties.find((p: any) => p.siteUrl === "sc-domain:example.com");
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/ingest`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    // Test-only divergent fixture (see e2e-fixtures.seedSignalSnapshot):
    // mock ingest alone yields identical current/prior → no-signal.
    await seedSignalSnapshot(testApp.prisma, { workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const fixRes1 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
    const fix1 = fixRes1.body.fix.id as string;
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix1}/dismiss`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({ reason: "other" })
      .expect(201);
    // A fresh recommendation after dismissal creates the second fix.
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const fixRes2 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
    const fix2 = fixRes2.body.fix.id as string;
    // Measure fix2 (setup-only direct DB: elapsed window + post snapshot).
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix2}/apply`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    await testApp.prisma.fix.update({ where: { id: fix2 }, data: { expectedMeasurementDate: new Date(Date.now() - 1000) } });
    const now = new Date();
    await testApp.prisma.searchDataSnapshot.create({
      data: {
        workspaceId,
        propertyId: prop.id,
        siteUrl: prop.siteUrl,
        periodStart: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
        periodEnd: now,
        periodLabel: "Last 14 days",
        dataThrough: now,
        retrievedAt: now,
        freshness: "fresh",
        quality: "complete",
        limitations: [],
        normalizedJson: {
          meta: {
            source: { id: "google-search-console", label: "Google Search Console" },
            property: { id: prop.id, name: "example.com", type: "domain", siteUrl: prop.siteUrl },
            period: { start: new Date(now.getTime() - 14 * 86400000).toISOString(), end: now.toISOString(), label: "Last 14 days" },
            dataThrough: now.toISOString(),
            retrievedAt: now.toISOString(),
            freshness: "fresh",
            quality: "complete",
            limitations: [],
          },
          page: { page: "/pricing", clicks: 150, impressions: 5000, ctr: 0.03, position: 3.0 },
          comparisonPage: { page: "/pricing", clicks: 100, impressions: 5000, ctr: 0.02, position: 4.2 },
          queries: [{ query: "pricing plans", clicks: 50, impressions: 1000, ctr: 0.05, position: 3 }],
        } as any,
        rawResponseHash: `hist-shared-${Date.now()}-${Math.random()}`,
        rowCount: 1,
      },
    });
    const check = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix2}/check`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect(check.body.status).not.toBe("measurement_pending");
    // Deterministic timestamps for ordering assertions.
    await testApp.prisma.fix.update({ where: { id: fix1 }, data: { createdAt: new Date("2026-08-01T00:00:00.000Z") } });
    await testApp.prisma.fix.update({ where: { id: fix2 }, data: { createdAt: new Date("2026-08-02T00:00:00.000Z") } });
    shared = { agent, workspaceId, propertyId: prop.id as string, siteUrl: prop.siteUrl as string, fix1, fix2 };
  });

  afterAll(async () => {
    await truncateAll(testApp.prisma);
    await closeTestApp(testApp);
  });

  it("1. history requires auth (401 unauthenticated)", async () => {
    const { workspaceId } = shared;
    await request(testApp.app.getHttpServer()).get(`/api/v1/workspaces/${workspaceId}/history`).expect(401);
  });

  it("2. history workspace isolation (403 for another workspace)", async () => {
    const { workspaceId: wsA } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(testApp.app, "hist-iso-b");
    await agentB.get(`/api/v1/workspaces/${wsA}/history`).expect(403);
    await shared.agent.get(`/api/v1/workspaces/${wsB}/history`).expect(403);
  });

  it("3. history ordering is newest first and deterministic", async () => {
    const { agent, workspaceId, fix1, fix2 } = shared;
    const res = await agent.get(`/api/v1/workspaces/${workspaceId}/history`).expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].id).toBe(fix2);
    expect(res.body.items[1].id).toBe(fix1);
    expect(res.body.items[1].status).toBe("dismissed");
    expect(res.body.items[0].status).toBe("measured");
  });

  it("4. history pagination/limit (limit=1 returns one item with the full total; invalid limit is 400)", async () => {
    const { agent, workspaceId } = shared;
    const page1 = await agent.get(`/api/v1/workspaces/${workspaceId}/history?limit=1`).expect(200);
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.total).toBe(2);
    expect(page1.body.limit).toBe(1);

    const page2 = await agent.get(`/api/v1/workspaces/${workspaceId}/history?limit=1&offset=1`).expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

    await agent.get(`/api/v1/workspaces/${workspaceId}/history?limit=0`).expect(400);
  });

  it("5. history detail success returns recommendation + evidence + lifecycle", async () => {
    const { agent, workspaceId, propertyId, fix1 } = shared;
    const res = await agent.get(`/api/v1/workspaces/${workspaceId}/history/${fix1}`).expect(200);
    const item = res.body.item;
    expect(item.id).toBe(fix1);
    expect(item.propertyId).toBe(propertyId);
    expect(item.status).toBe("dismissed");
    expect(item.recommendedChange).toBeDefined();
    expect(item.fix).toBeDefined();
    expect(item.fix.finding).toBeDefined();
    expect(item.fix.recommendedChange).toBeDefined();
    expect(item.fix.evidence).toBeDefined();
    expect(Array.isArray(item.fix.evidence.rows)).toBe(true);
    expect(item.fix.dataMeta).toBeDefined();
    expect(item.fix.dataMeta.source.id).toBe("google-search-console");
  });

  it("6. history detail cross-workspace returns 404 (no leak)", async () => {
    const { fix1 } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(testApp.app, "hist-xws-b");
    // B guesses A's fix id inside B's workspace → 404, not the item.
    const res = await agentB.get(`/api/v1/workspaces/${wsB}/history/${fix1}`).expect(404);
    expect(JSON.stringify(res.body)).not.toContain(fix1);
  });

  it("7. history detail property isolation (only the fix's own property data)", async () => {
    const { agent, workspaceId, propertyId, fix1 } = shared;
    const other = await createPropertyRow(testApp.prisma, { workspaceId, siteUrl: "sc-domain:second-property.test" });
    const res = await agent.get(`/api/v1/workspaces/${workspaceId}/history/${fix1}`).expect(200);
    expect(res.body.item.propertyId).toBe(propertyId);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(other.id);
  });

  it("8. outcome is included when available (measured fix)", async () => {
    const { agent, workspaceId, fix2 } = shared;
    const res = await agent.get(`/api/v1/workspaces/${workspaceId}/history/${fix2}`).expect(200);
    expect(res.body.item.status).toBe("measured");
    expect(res.body.item.outcome).toBeDefined();
    expect(res.body.item.outcome.before).toBeDefined();
    expect(res.body.item.outcome.after).toBeDefined();
    expect(res.body.item.fix.outcome).toBeDefined();
    // Dash-format statuses, never underscore wire format in the contract.
    expect(res.body.item.outcome.status).toMatch(/^[a-z-]+$/);

    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/history`).expect(200);
    expect(list.body.items.some((i: any) => i.id === fix2 && i.status === "measured")).toBe(true);
  });

  it("9. no token or internal-secret leakage in history responses", async () => {
    const { agent, workspaceId, fix2 } = shared;
    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/history`).expect(200);
    const detail = await agent.get(`/api/v1/workspaces/${workspaceId}/history/${fix2}`).expect(200);
    const combined = JSON.stringify({ list: list.body, detail: detail.body });
    expect(combined).not.toMatch(/encryptedAccessToken/i);
    expect(combined).not.toMatch(/encryptedRefreshToken/i);
    expect(combined).not.toMatch(/refresh_token/i);
    expect(combined).not.toMatch(/access_token/i);
    expect(combined).not.toMatch(/Bearer/i);
    expect(combined).not.toMatch(/passwordHash/i);
    expect(combined).not.toMatch(/siteUrl/i);
  });
});
