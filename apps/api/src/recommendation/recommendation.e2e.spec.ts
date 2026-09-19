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

describe("Recommendation Engine Integration (Prompt 11)", () => {
  // ONE expensive setup per app lifetime (sync 1/5min, ingest 10/min).
  // Tests 22→26 walk ONE fix through its lifecycle in file order
  // (available → reviewed → applied → dismissed); all other tests are
  // read-only. Guards remain fully enforced throughout.
  let testApp: TestApp;
  let shared: { agent: any; workspaceId: string; propertyId: string; fixId: string };

  beforeAll(async () => {
    testApp = await createTestApp();
    await truncateAll(testApp.prisma);
    const { agent, workspaceId } = await signupAgent(testApp.app, "rec");
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/sync`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    const list = await agent.get(`/api/v1/workspaces/${workspaceId}/properties`).expect(200);
    const prop = list.body.properties.find((p: any) => p.name === "example.com");
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/ingest`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    // Test-only divergent fixture: mock GSC returns identical current/prior
    // rows (real engine → no-signal). Seed a real normalized snapshot with a
    // deterministic CTR decline; the recommendation endpoint is still hit
    // through HTTP below.
    await seedSignalSnapshot(testApp.prisma, { workspaceId, propertyId: prop.id, siteUrl: "sc-domain:example.com" });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const fix = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
    shared = { agent, workspaceId, propertyId: prop.id as string, fixId: fix.body.fix.id as string };
  });

  afterAll(async () => {
    await truncateAll(testApp.prisma);
    await closeTestApp(testApp);
  });

  it("18. repeated recommendation request does not create duplicate Fixes (idempotency)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const r1 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(r1.body.status).toBe("recommendation-available");
    expect(r1.body.recommendation).toBeDefined();

    const r2 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(r2.body.status).toBe("recommendation-available");
    const fix2 = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    expect(fix2.body.fix?.id).toBe(fixId);

    const count = await testApp.prisma.fix.count({
      where: { workspaceId, propertyId, status: { in: ["available", "reviewed", "applied"] } },
    });
    // Should be 1, not 2, despite repeated GETs
    expect(count).toBe(1);
  });

  it("19. workspace isolation on recommendation (403)", async () => {
    const { workspaceId: wsA, propertyId: propA } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(testApp.app, "rec-iso-b");
    await agentB.get(`/api/v1/workspaces/${wsA}/properties/${propA}/recommendation`).expect(403);
    await shared.agent.get(`/api/v1/workspaces/${wsB}/properties/${propA}/recommendation`).expect(403);
  });

  it("20. property isolation (404 if property not in workspace)", async () => {
    const { propertyId: propA } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(testApp.app, "rec-iso-c");
    // B owns a property of their own (setup-only direct row); A's property is foreign.
    await createPropertyRow(testApp.prisma, { workspaceId: wsB, siteUrl: "sc-domain:b-property.test" });
    await agentB.get(`/api/v1/workspaces/${wsB}/properties/${propA}/recommendation`).expect(404);
  });

  it("21. unauthorized fix access denied (404)", async () => {
    const { fixId } = shared;
    const { agent: agentB, workspaceId: wsB } = await signupAgent(testApp.app, "rec-iso-d");
    const propB = await createPropertyRow(testApp.prisma, { workspaceId: wsB, siteUrl: "sc-domain:b2-property.test" });
    // B tries to access A's fix via B's property (should be 404)
    await agentB
      .post(`/api/v1/workspaces/${wsB}/properties/${propB.id}/fix/${fixId}/review`)
      .set("x-csrf-token", await csrfToken(agentB))
      .send({})
      .expect(404);
  });

  it("22. review lifecycle (available→reviewed)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const fixBefore = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    expect(fixBefore.body.fix.status).toBe("available");
    const reviewed = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/review`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect(reviewed.body.fix.status).toBe("reviewed");
  });

  it("23. apply lifecycle (reviewed→applied with baseline)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const applied = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/apply`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect(applied.body.fix.status).toBe("applied");
    expect(applied.body.fix.appliedAt).toBeDefined();
    expect(applied.body.fix.expectedMeasurementDate).toBeDefined();
    expect(applied.body.fix.baselineClicks).toBeDefined();
  });

  it("24. dismiss lifecycle", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const dismissed = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/dismiss`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({ reason: "not-a-priority" })
      .expect(201);
    expect(dismissed.body.fix.status).toBe("dismissed");
  });

  it("25. acknowledge lifecycle (idempotent)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    // fixId is dismissed with no outcome here → acknowledge is a no-op success.
    const ack = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/acknowledge`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect(ack.body.ok).toBe(true);
  });

  it("26. check endpoint does not fabricate measurement (pending)", async () => {
    const { agent, workspaceId, propertyId, fixId } = shared;
    const check = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/check`)
      .set("x-csrf-token", await csrfToken(agent))
      .send({})
      .expect(201);
    expect(check.body.status).toBe("measurement_pending");
    expect(JSON.stringify(check.body)).not.toMatch(/positive|negative/i);
  });

  it("27-28. no confidence/SEO score in recommendation", async () => {
    const { agent, workspaceId, propertyId } = shared;
    // fixId is dismissed: the same persisting signal is now remembered
    // (Prompt 2), so surface genuinely new evidence first — the language
    // assertions below keep their original intent on the new incarnation.
    await seedSignalSnapshot(testApp.prisma, { workspaceId, propertyId, siteUrl: "sc-domain:example.com" }, {
      clicks: 84,
      impressions: 3400,
      ctr: 0.0247,
      position: 4.7,
      priorClicks: 110,
      priorImpressions: 3300,
      priorCtr: 0.0333,
      priorPosition: 4.4,
      queries: [
        { query: "pricing plans", clicks: 38, impressions: 1250, ctr: 0.03, position: 4.3 },
        { query: "team pricing", clicks: 16, impressions: 720, ctr: 0.022, position: 4.9 },
      ],
      periodLabel: "Fresh window vs. prior",
    });
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    expect(rec.body.status).toBe("recommendation-available");
    const str = JSON.stringify(rec.body);
    expect(str).not.toMatch(/confidence/i);
    expect(str).not.toMatch(/seo.*score/i);
    expect(str).not.toMatch(/"score"/i);
  });

  it("29. no causal claims in recommendation language", async () => {
    const { agent, workspaceId, propertyId } = shared;
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    const r = rec.body.recommendation;
    const text = `${r.finding} ${r.interpretation} ${r.recommendedAction} ${r.rationale}`.toLowerCase();
    expect(text).not.toContain("will increase");
    expect(text).not.toContain("will boost");
    expect(text).not.toContain("guarantees");
    expect(text).not.toContain("google prefers");
  });

  it("fix endpoints require CSRF (403 without)", async () => {
    const { agent, workspaceId, propertyId } = shared;
    const fixRes = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    const currentId = fixRes.body.fix.id as string;
    await agent.post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${currentId}/review`).send({}).expect(403);
  });

  it("no Google token in recommendation/fix responses", async () => {
    const { agent, workspaceId, propertyId } = shared;
    const rec = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/recommendation`).expect(200);
    const fix = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix`).expect(200);
    const combined = JSON.stringify({ rec: rec.body, fix: fix.body });
    expect(combined).not.toMatch(/mock_access/i);
    expect(combined).not.toMatch(/Bearer/i);
    expect(combined).not.toMatch(/refresh_token/i);
    expect(combined).not.toMatch(/encryptedAccessToken/i);
  });
});
