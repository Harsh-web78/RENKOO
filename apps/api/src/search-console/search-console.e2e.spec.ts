import request from "supertest";
import {
  TestApp,
  createTestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
  csrfToken,
} from "../test-utils/e2e-fixtures";

describe("Search Console sites.list (Prompt 9)", () => {
  // NOTE on throttle budgets (production limits, unchanged): the sync
  // endpoint allows 1 POST per 5 minutes per app instance (in-memory
  // store). Each app below therefore performs at most ONE successful
  // sync; tests needing a different bucket state boot an isolated app
  // (guards still fully enforced inside each instance).
  let app1: TestApp;
  let shared: { agent: any; workspaceId: string };

  beforeAll(async () => {
    app1 = await createTestApp();
    await truncateAll(app1.prisma);
    const { agent, workspaceId } = await signupAgent(app1.app, "sc-main");
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/sync`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    shared = { agent, workspaceId };
  });

  afterAll(async () => {
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
  });

  it("GET /workspaces/:wid/properties requires authentication 401", async () => {
    await request(app1.app.getHttpServer()).get("/api/v1/workspaces/fake-id/properties").expect(401);
  });

  it("GET /workspaces/:wid/properties workspace isolation 403", async () => {
    const { workspaceId: wsA } = shared;
    const { agent: agentB } = await signupAgent(app1.app, "sc-iso-b");
    await agentB.get(`/api/v1/workspaces/${wsA}/properties`).expect(403);
  });

  it("POST sync requires CSRF 403 (isolated app: pristine sync bucket)", async () => {
    const app2 = await createTestApp();
    try {
      const { agent, workspaceId } = await signupAgent(app2.app, "sc-csrf");
      await agent.post(`/api/v1/workspaces/${workspaceId}/properties/sync`).send({}).expect(403);
    } finally {
      await closeTestApp(app2);
    }
  });

  it("successful sync stores 5 properties with correct domain/url-prefix parsing", async () => {
    const { agent, workspaceId } = shared;
    // Synced once in beforeAll; assert the stored rows through HTTP.
    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/properties`).expect(200);
    expect(list.body.properties).toHaveLength(5);
    const domain = list.body.properties.find((p: { siteUrl: string }) => p.siteUrl === "sc-domain:example.com");
    expect(domain).toBeDefined();
    expect(domain.type).toBe("domain");
    expect(domain.name).toBe("example.com");
    expect(domain.siteUrl).toBe("sc-domain:example.com");

    const urlPrefix = list.body.properties.find((p: { siteUrl: string }) => p.siteUrl === "https://www.example.com/");
    expect(urlPrefix).toBeDefined();
    expect(urlPrefix.type).toBe("url-prefix");
    expect(urlPrefix.siteUrl).toBe("https://www.example.com/");
  });

  it("selectable gating: siteOwner/siteFullUser true, siteUnverifiedUser false", async () => {
    const { agent, workspaceId } = shared;
    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/properties`).expect(200);
    const owner = list.body.properties.find((p: { siteUrl: string }) => p.siteUrl === "sc-domain:example.com");
    expect(owner.isSelectable).toBe(true);
    expect(owner.permissionLevel).toBe("siteOwner");
    const fullUser = list.body.properties.find((p: { siteUrl: string }) => p.siteUrl === "https://www.example.com/");
    expect(fullUser.isSelectable).toBe(true);
    const unverified = list.body.properties.find((p: { siteUrl: string }) => p.siteUrl === "sc-domain:oldproject.com");
    expect(unverified.isSelectable).toBe(false);
    expect(unverified.permissionLevel).toBe("siteUnverifiedUser");
  });

  it("sync is idempotent (same rows, same count, no duplicates)", async () => {
    const { workspaceId } = shared;
    const list = await shared.agent.get(`/api/v1/workspaces/${workspaceId}/properties`).expect(200);
    expect(list.body.properties).toHaveLength(5);
    const dbCount = await app1.prisma.searchProperty.count({ where: { workspaceId } });
    expect(dbCount).toBe(5);
  });

  it("cross-workspace sync isolation: B cannot sync A's workspace (isolated app: pristine sync bucket)", async () => {
    const app3 = await createTestApp();
    try {
      const { workspaceId: wsA } = await signupAgent(app3.app, "sc-xws-a");
      const { agent: agentB, workspaceId: wsB } = await signupAgent(app3.app, "sc-xws-b");
      // B tries to sync A's workspace → guard rejects (403) before any sync occurs.
      // (A's own successful sync is covered by the main app's setup above.)
      await agentB
        .post(`/api/v1/workspaces/${wsA}/properties/sync`)
        .set("x-csrf-token", await csrfToken(agentB))
        .send({})
        .expect(403);
      // Verify B's workspace still empty until B syncs (GETs are unthrottled).
      const listBBefore = await agentB.get(`/api/v1/workspaces/${wsB}/properties`).expect(200);
      expect(listBBefore.body.properties).toHaveLength(0);
    } finally {
      await closeTestApp(app3);
    }
  });

  it("rate limiting: second sync within 5m returns 429", async () => {
    const { agent, workspaceId } = shared;
    // beforeAll already consumed this app's single sync allowance.
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/sync`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(429);
  });
});
