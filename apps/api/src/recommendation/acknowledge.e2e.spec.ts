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

/**
 * Acknowledged state + lifecycle rules (Prompt 14 §2–§3).
 * See docs/lifecycle-rules.md (R1–R5).
 *
 * Throttle budget (production limits, unchanged): each app below performs
 * exactly ONE sync + ONE ingest; App1 shares a single measured fix across
 * tests 1–5, App2 owns the dismiss/fresh-data rules (R2/R4).
 */
describe("Acknowledged state + lifecycle rules (Prompt 14)", () => {
  let app1: TestApp;
  let shared: { agent: any; workspaceId: string; propertyId: string; fixId: string };

  async function measureShared(
    testApp: TestApp,
    agent: any,
    workspaceId: string,
    propertyId: string,
    siteUrl: string,
    fixId: string,
  ): Promise<void> {
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/apply`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    await testApp.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 1000) } });
    const now = new Date();
    await testApp.prisma.searchDataSnapshot.create({
      data: {
        workspaceId,
        propertyId,
        siteUrl,
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
            property: { id: propertyId, name: "example.com", type: "domain", siteUrl },
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
        rawResponseHash: `ack-shared-${Date.now()}-${Math.random()}`,
        rowCount: 1,
      },
    });
    const check = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/check`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect(check.body.status).not.toBe("measurement_pending");
  }

  beforeAll(async () => {
    app1 = await createTestApp();
    await truncateAll(app1.prisma);
    const { agent, workspaceId } = await signupAgent(app1.app, "ack");
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
    await seedSignalSnapshot(app1.prisma, { workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const fixRes = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
    const fixId = fixRes.body.fix.id as string;
    await measureShared(app1, agent, workspaceId, prop.id, prop.siteUrl, fixId);
    shared = { agent, workspaceId, propertyId: prop.id as string, fixId };
  });

  afterAll(async () => {
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
  });

  it("1. acknowledge persists server-side (status acknowledged)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/acknowledge`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    const row = await app1.prisma.fix.findUnique({ where: { id: fixId } });
    expect(row?.status).toBe("acknowledged");
  });

  it("2. acknowledged fix does not reappear after reload (getFix null, recommendation no-signal)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    // Hard-reload simulation: fresh reads, same session.
    const fix = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    expect(fix.body.fix).toBeNull();
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("no-signal");
    expect(rec.body.recommendation).toBeUndefined();
    // And the acknowledged measured fix remains visible in history.
    const history = await agent.get(`/api/v1/workspaces/${workspaceId}/history`).expect(200);
    const entry = (history.body.items as any[]).find((i) => i.id === fixId);
    expect(entry).toBeDefined();
    expect(entry.status).toBe("measured");
    expect(entry.outcome).toBeDefined();
  });

  it("3. another workspace cannot acknowledge or read the fix (404, no leak)", async () => {
    const { workspaceId: wsA, fixId } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(app1.app, "ack-xws-b");
    // B owns no synced property; the path target is a setup-only direct row.
    const target = await createPropertyRow(app1.prisma, { workspaceId: wsB, siteUrl: "sc-domain:b-property.test" });
    await agentB
      .post(`/api/v1/workspaces/${wsB}/properties/${target.id}/fix/${fixId}/acknowledge`)
      .set("x-csrf-token", await csrfToken(agentB))
      .send({})
      .expect(404);
    await agentB.get(`/api/v1/workspaces/${wsB}/history/${fixId}`).expect(404);
    // A's fix is untouched.
    const row = await app1.prisma.fix.findUnique({ where: { id: fixId } });
    expect(row?.status).toBe("acknowledged");
    expect(row?.workspaceId).toBe(wsA);
  });

  it("4. acknowledged history detail keeps correct property filtering", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const detail = await agent.get(`/api/v1/workspaces/${workspaceId}/history/${fixId}`).expect(200);
    expect(detail.body.item.propertyId).toBe(propertyId);
    expect(detail.body.item.status).toBe("measured");
  });

  it("5. acknowledgement is idempotent (repeat ack stays ok, single row)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const token = await csrfToken(agent);
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/acknowledge`)
      .set("x-csrf-token", token)
      .send({})
      .expect(201);
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/acknowledge`)
      .set("x-csrf-token", token)
      .send({})
      .expect(201);
    const count = await app1.prisma.fix.count({ where: { id: fixId } });
    expect(count).toBe(1);
    const row = await app1.prisma.fix.findUnique({ where: { id: fixId } });
    expect(row?.status).toBe("acknowledged");
  });

  it("R2. dismiss → next recommendation creates exactly one new active fix; dismissed stays dismissed", async () => {
    // Isolated app: this rule needs its own sync/ingest budget.
    const app2 = await createTestApp();
    try {
      const { agent, workspaceId } = await signupAgent(app2.app, "dismiss-rule");
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
      // Test-only divergent fixture (see e2e-fixtures.seedSignalSnapshot).
      await seedSignalSnapshot(app2.prisma, { workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl });
      await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
      const fixRes = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
      const fix1 = fixRes.body.fix.id as string;
      await agent
        .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix1}/dismiss`)
        .set("x-csrf-token", await csrfToken(agent))
        .send({ reason: "other" })
        .expect(201);
      const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
      expect(rec.body.status).toBe("recommendation-available");
      const fixRes2 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
      const fix2 = fixRes2.body.fix.id as string;
      expect(fix2).not.toBe(fix1);
      // Exactly one active fix for the property; the dismissed row is untouched.
      const active = await app2.prisma.fix.count({
        where: { workspaceId, propertyId: prop.id, status: { in: ["available", "reviewed", "applied"] } },
      });
      expect(active).toBe(1);
      const old = await app2.prisma.fix.findUnique({ where: { id: fix1 } });
      expect(old?.status).toBe("dismissed");

      // R4. fresh snapshot period with a persisting signal may surface a new fix (deterministic).
      // Measure + acknowledge fix2 first so the suppression rule engages.
      await agent
        .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix2}/apply`)
        .set("x-csrf-token", await csrfToken(agent))
        .send({})
        .expect(201);
      await app2.prisma.fix.update({ where: { id: fix2 }, data: { expectedMeasurementDate: new Date(Date.now() - 1000) } });
      const now = new Date();
      await app2.prisma.searchDataSnapshot.create({
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
          rawResponseHash: `ack-r4-${Date.now()}-${Math.random()}`,
          rowCount: 1,
        },
      });
      const check = await agent
        .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix2}/check`)
        .set("x-csrf-token", await csrfToken(agent))
        .send({})
        .expect(201);
      expect(check.body.status).not.toBe("measurement_pending");
      await agent
        .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fix2}/acknowledge`)
        .set("x-csrf-token", await csrfToken(agent))
        .send({})
        .expect(201);
      // Same snapshot → suppressed.
      const suppressed = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
      expect(suppressed.body.status).toBe("no-signal");
      // Simulate fresh data: a newer snapshot with a different period that
      // still carries a strong signal.
      const freshNow = new Date();
      const periodStart = new Date(freshNow.getTime() - 28 * 86400000);
      await app2.prisma.searchDataSnapshot.create({
        data: {
          workspaceId,
          propertyId: prop.id,
          siteUrl: prop.siteUrl,
          periodStart,
          periodEnd: freshNow,
          periodLabel: "Fresh window",
          dataThrough: freshNow,
          retrievedAt: new Date(freshNow.getTime() + 1000),
          freshness: "fresh",
          quality: "complete",
          limitations: [],
          normalizedJson: {
            meta: {
              source: { id: "google-search-console", label: "Google Search Console" },
              property: { id: prop.id, name: "example.com", type: "domain", siteUrl: prop.siteUrl },
              period: { start: periodStart.toISOString(), end: freshNow.toISOString(), label: "Fresh window" },
              dataThrough: freshNow.toISOString(),
              retrievedAt: freshNow.toISOString(),
              freshness: "fresh",
              quality: "complete",
              limitations: [],
            },
            page: { page: "/pricing", clicks: 40, impressions: 3000, ctr: 0.013, position: 4.5 },
            comparisonPage: { page: "/pricing", clicks: 120, impressions: 2900, ctr: 0.041, position: 4.3 },
            queries: [
              { query: "pricing plans", clicks: 25, impressions: 1500, ctr: 0.016, position: 4.4 },
              { query: "renko pricing", clicks: 10, impressions: 900, ctr: 0.011, position: 4.6 },
            ],
          } as any,
          rawResponseHash: `fresh-hash-${Date.now()}-${Math.random()}`,
          rowCount: 2,
        },
      });
      const fresh = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
      expect(fresh.body.status).toBe("recommendation-available");
      const current = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
      expect(current.body.fix.id).not.toBe(fix2);
    } finally {
      await closeTestApp(app2);
    }
  });
});
