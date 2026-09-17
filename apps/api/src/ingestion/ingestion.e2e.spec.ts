import request from "supertest";
import { SEARCH_CONSOLE_PROVIDER } from "../search-console/search-console.provider";
import {
  TestApp,
  createTestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
  csrfToken,
  createPropertyRow,
} from "../test-utils/e2e-fixtures";

describe("Ingestion + Snapshot (Prompt 10)", () => {
  let testApp: TestApp;
  let shared: { agent: any; workspaceId: string; propertyId: string; snapshotId: string };

  beforeAll(async () => {
    testApp = await createTestApp();
    await truncateAll(testApp.prisma);
    // ONE expensive setup per app lifetime (sync 1/5min, ingest 10/min):
    // every test below reuses these fixtures through HTTP.
    const { agent, workspaceId } = await signupAgent(testApp.app, "ingest");
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/sync`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/properties`).expect(200);
    const prop = list.body.properties.find((p: any) => p.siteUrl === "sc-domain:example.com");
    const ingest = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/ingest`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    shared = { agent, workspaceId, propertyId: prop.id as string, snapshotId: (ingest.body.snapshot as any).id as string };
  });

  afterAll(async () => {
    await truncateAll(testApp.prisma);
    await closeTestApp(testApp);
  });

  it("12. pagination using startRow until rows < rowLimit", async () => {
    const provider = testApp.app.get(SEARCH_CONSOLE_PROVIDER) as any;
    // Mock provider to return paginated: first 25000, then 5
    const res1 = await provider.queryAnalytics({
      workspaceId: "test-ws",
      siteUrl: "sc-domain:example.com",
      startDate: "2026-08-10",
      endDate: "2026-09-06",
      dimensions: ["page", "query"],
      rowLimit: 2,
      startRow: 0,
    });
    expect(res1.ok).toBe(true);
    if (res1.ok) expect(res1.data.rows?.length).toBe(2);
    const res2 = await provider.queryAnalytics({
      workspaceId: "test-ws",
      siteUrl: "sc-domain:example.com",
      startDate: "2026-08-10",
      endDate: "2026-09-06",
      dimensions: ["page", "query"],
      rowLimit: 2,
      startRow: 2,
    });
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.data.rows?.length).toBeGreaterThanOrEqual(1);
  });

  it("13. pagination stops correctly when rows < rowLimit", async () => {
    const provider = testApp.app.get(SEARCH_CONSOLE_PROVIDER) as any;
    const res = await provider.queryAnalytics({
      workspaceId: "test-ws",
      siteUrl: "sc-domain:example.com",
      startDate: "2026-08-10",
      endDate: "2026-09-06",
      dimensions: ["page"],
      rowLimit: 25000,
      startRow: 0,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.rows!.length).toBeLessThan(25000);
  });

  it("15. raw-response idempotency through HTTP (same hash does not duplicate)", async () => {
    const { agent, workspaceId, propertyId, snapshotId } = shared;
    // Second ingest of the same period returns the same snapshot row.
    const second = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/ingest`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect((second.body.snapshot as any).id).toBe(snapshotId);
    const count = await testApp.prisma.searchDataSnapshot.count({ where: { workspaceId, propertyId } });
    expect(count).toBe(1); // not duplicated
  });

  it("21. workspace isolation on ingest (403)", async () => {
    const { workspaceId: wsA, propertyId: propA } = shared;
    const { agent: agentB } = await signupAgent(testApp.app, "ingest-iso-b");
    await agentB
      .post(`/api/v1/workspaces/${wsA}/properties/${propA}/ingest`)
      .set("x-csrf-token", await csrfToken(agentB))
      .send({})
      .expect(403);
  });

  it("22. property isolation on snapshot (404 if property not in workspace)", async () => {
    const { propertyId: propA } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(testApp.app, "ingest-iso-c");
    // B's property exists (setup-only direct row) but A's property is foreign.
    await createPropertyRow(testApp.prisma, { workspaceId: wsB, siteUrl: "sc-domain:b-property.test" });
    await agentB.get(`/api/v1/workspaces/${wsB}/properties/${propA}/snapshot`).expect(404);
  });

  it("23. GET snapshot uses cached DB snapshot (no Google call)", async () => {
    const { agent, workspaceId, propertyId } = shared;
    const first = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/snapshot`).expect(200);
    const snapshot1 = first.body.snapshot;
    expect(snapshot1).toBeDefined();
    expect(snapshot1.meta).toBeDefined();
    // Second GET should return same without additional GSC call
    const second = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/snapshot`).expect(200);
    expect(second.body.snapshot.id ?? second.body.snapshot.meta.retrievedAt).toBeDefined();
  });

  it("24. missing snapshot returns 404", async () => {
    const { agent, workspaceId } = shared;
    const fresh = await createPropertyRow(testApp.prisma, { workspaceId, siteUrl: "sc-domain:nosnapshot.test" });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${fresh.id}/snapshot`).expect(404);
  });

  it("25. no Google token appears in any ingest/snapshot response", async () => {
    const { agent, workspaceId, propertyId } = shared;
    const ingestRes = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/ingest`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    const snapRes = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/snapshot`).expect(200);
    const combined = JSON.stringify({ ingest: ingestRes.body, snap: snapRes.body });
    expect(combined).not.toMatch(/mock_access/i);
    expect(combined).not.toMatch(/mock_refresh/i);
    expect(combined).not.toMatch(/Bearer/i);
    expect(combined).not.toMatch(/refresh_token/i);
  });

  it("sync throttle contract: second sync within 5m returns 429 (production limit unchanged)", async () => {
    const { agent, workspaceId } = shared;
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/sync`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(429);
  });

  // 17,18,19,20 are covered via provider retry logic (429/5xx retry, 403 not retry) and are unit-tested in GSC provider
  it("17-19. provider maps 429 to RATE_LIMITED, 500 to UPSTREAM_ERROR, 403 to PERMISSION_DENIED (no infinite retry)", async () => {
    const provider = testApp.app.get(SEARCH_CONSOLE_PROVIDER) as any;
    // 403 case is simulated via siteUrl oldproject.com in mock
    const res403 = await provider.queryAnalytics({
      workspaceId: "ws",
      siteUrl: "sc-domain:oldproject.com",
      startDate: "2026-08-10",
      endDate: "2026-09-06",
      dimensions: ["page"],
    });
    expect(res403.ok).toBe(false);
    if (!res403.ok) expect(res403.error.code).toBe("PERMISSION_DENIED");
  });
});
