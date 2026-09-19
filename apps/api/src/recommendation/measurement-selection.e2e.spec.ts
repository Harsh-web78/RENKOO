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
 * Measure layer (Prompt 3): manual checkFix compares the pinned apply-time
 * baseline against the earliest genuinely post-window snapshot.
 *
 * Conventions: check/fix/recommendation go through HTTP; snapshots and date
 * manipulation are setup-only direct-DB writes. Two app instances spread the
 * per-app throttle budgets (global 60/min/IP); one signup per app, direct
 * property rows per test, one reused CSRF token per agent.
 */
describe("Measurement post-window selection (Prompt 3)", () => {
  let app1: TestApp;
  let app2: TestApp;

  /** Direct snapshot write with caller-controlled retrieval time. */
  async function writeSnapshot(
    prisma: TestApp["prisma"],
    params: {
      workspaceId: string;
      propertyId: string;
      siteUrl: string;
      retrievedAt: Date;
      page: { page: string; clicks: number; impressions: number; ctr: number; position: number };
    },
  ): Promise<{ id: string }> {
    const periodStart = new Date(params.retrievedAt.getTime() - 28 * 24 * 60 * 60 * 1000);
    const row = await prisma.searchDataSnapshot.create({
      data: {
        workspaceId: params.workspaceId,
        propertyId: params.propertyId,
        siteUrl: params.siteUrl,
        periodStart,
        periodEnd: params.retrievedAt,
        periodLabel: "Window probe",
        dataThrough: params.retrievedAt,
        retrievedAt: params.retrievedAt,
        freshness: "fresh",
        quality: "complete",
        limitations: [],
        normalizedJson: {
          meta: {
            source: { id: "google-search-console", label: "Google Search Console" },
            property: { id: params.propertyId, name: "example.com", type: "domain", siteUrl: params.siteUrl },
            period: { start: periodStart.toISOString(), end: params.retrievedAt.toISOString(), label: "Window probe" },
            dataThrough: params.retrievedAt.toISOString(),
            retrievedAt: params.retrievedAt.toISOString(),
            freshness: "fresh",
            quality: "complete",
            limitations: [],
          },
          page: params.page,
          comparisonPage: null,
          queries: [],
        } as any,
        rawResponseHash: `measure-probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        rowCount: 1,
      },
    });
    return { id: row.id };
  }

  /**
   * Fresh property + canonical seed (Snapshot A) + recommendation + HTTP
   * apply. The apply pins the baseline to Snapshot A; returns its id for
   * pin assertions.
   */
  async function setupApplied(
    app: TestApp,
    agent: any,
    workspaceId: string,
    token: string,
    tag: string,
  ): Promise<{ propertyId: string; siteUrl: string; fixId: string; snapshotAId: string }> {
    const prop = await createPropertyRow(app.prisma, { workspaceId, siteUrl: `sc-domain:${tag}.test` });
    const seed = await seedSignalSnapshot(app.prisma, { workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const fixRes = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
    const fixId = fixRes.body.fix.id as string;
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fixId}/apply`)
      .set("x-csrf-token", token)
      .send({})
      .expect(201);
    return { propertyId: prop.id, siteUrl: prop.siteUrl, fixId, snapshotAId: seed.id };
  }

  async function check(agent: any, workspaceId: string, propertyId: string, fixId: string, token: string): Promise<any> {
    const res = await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${propertyId}/fix/${fixId}/check`)
      .set("x-csrf-token", token)
      .send({})
      .expect(201);
    return res.body;
  }

  /** After-data shape: deterministic positive_change vs the seed baseline (60 clicks, 2.0%, 4.5). */
  function afterPage(clicks: number) {
    return { page: "/pricing", clicks, impressions: 2100, ctr: 0.035, position: 3.8 };
  }

  let agent1: any;
  let workspace1: string;
  let token1: string;
  let agent2: any;
  let workspace2a: string;
  let workspace2b: string;
  let token2a: string;

  beforeAll(async () => {
    app1 = await createTestApp();
    app2 = await createTestApp();
    await truncateAll(app1.prisma);
    const s1 = await signupAgent(app1.app, "meas-sel-1");
    agent1 = s1.agent;
    workspace1 = s1.workspaceId;
    token1 = await csrfToken(agent1);
    const s2a = await signupAgent(app2.app, "meas-sel-2a");
    agent2 = s2a.agent;
    workspace2a = s2a.workspaceId;
    token2a = await csrfToken(agent2);
    const s2b = await signupAgent(app2.app, "meas-sel-2b");
    workspace2b = s2b.workspaceId;
  });

  afterAll(async () => {
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
    await closeTestApp(app2);
  });

  it("1. check before the window → measurement_pending, no outcome", async () => {
    const { propertyId, fixId } = await setupApplied(app1, agent1, workspace1, token1, "ms-t1");
    const body = await check(agent1, workspace1, propertyId, fixId, token1);
    expect(body.status).toBe("measurement_pending");
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
  });

  it("2. window elapsed, only the baseline snapshot → data_delayed, no self-comparison", async () => {
    const { propertyId, fixId } = await setupApplied(app1, agent1, workspace1, token1, "ms-t2");
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    const body = await check(agent1, workspace1, propertyId, fixId, token1);
    expect(body.status).toBe("data_delayed");
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect((await app1.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
  });

  it("3. post-window snapshot B → classifier runs A → B", async () => {
    const { propertyId, siteUrl, fixId, snapshotAId } = await setupApplied(app1, agent1, workspace1, token1, "ms-t3");
    // Baseline is pinned to Snapshot A at apply time.
    expect((await app1.prisma.fix.findUnique({ where: { id: fixId } }))?.baselineSnapshotId).toBe(snapshotAId);
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app1.prisma, { workspaceId: workspace1, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const body = await check(agent1, workspace1, propertyId, fixId, token1);
    expect(body.status).toBe("positive-change");
    expect(body.outcome.before.clicks).toBe(60);
    expect(body.outcome.after.clicks).toBe(130);
    expect(body.outcome.message).toMatch(/does not establish causation/i);
  });

  it("4. earliest post-window snapshot wins (B day-14, not C day-20)", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app1, agent1, workspace1, token1, "ms-t4");
    const now = Date.now();
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(now - 21 * 86400_000) } });
    await writeSnapshot(app1.prisma, {
      workspaceId: workspace1, propertyId, siteUrl,
      retrievedAt: new Date(now - 7 * 86400_000), // day -7: first valid post-window row
      page: afterPage(130),
    });
    await writeSnapshot(app1.prisma, {
      workspaceId: workspace1, propertyId, siteUrl,
      retrievedAt: new Date(now), // day 0: newer, must NOT be selected
      page: afterPage(200),
    });
    const body = await check(agent1, workspace1, propertyId, fixId, token1);
    expect(body.outcome.after.clicks).toBe(130);
  });

  it("5. only pre-window snapshots → data_delayed", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app1, agent1, workspace1, token1, "ms-t5");
    const now = Date.now();
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(now - 3600_000) } });
    await writeSnapshot(app1.prisma, {
      workspaceId: workspace1, propertyId, siteUrl,
      retrievedAt: new Date(now - 30 * 86400_000), // strictly pre-window
      page: afterPage(130),
    });
    const body = await check(agent1, workspace1, propertyId, fixId, token1);
    expect(body.status).toBe("data_delayed");
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
  });

  it("6. snapshot exactly at retrievedAt = expectedMeasurementDate qualifies", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2a, token2a, "ms-t6");
    const boundary = new Date(Date.now() - 3600_000);
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: boundary } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2a, propertyId, siteUrl, retrievedAt: boundary, page: afterPage(130) });
    const body = await check(agent2, workspace2a, propertyId, fixId, token2a);
    expect(body.status).toBe("positive-change");
    expect(body.outcome.after.clicks).toBe(130);
  });

  it("7. baseline row that is also the latest row → no self-comparison", async () => {
    const { propertyId, fixId } = await setupApplied(app2, agent2, workspace2a, token2a, "ms-t7");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    const body = await check(agent2, workspace2a, propertyId, fixId, token2a);
    expect(body.status).toBe("data_delayed");
    expect(body.outcome.after).toBeNull();
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
  });

  it("8. existing outcome is replayed, never recalculated from newer snapshots", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2a, token2a, "ms-t8");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2a, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const first = await check(agent2, workspace2a, propertyId, fixId, token2a);
    expect(first.status).toBe("positive-change");
    // A much newer, much larger snapshot arrives — the recorded outcome stands.
    await writeSnapshot(app2.prisma, {
      workspaceId: workspace2a, propertyId, siteUrl,
      retrievedAt: new Date(Date.now() + 1000),
      page: afterPage(999),
    });
    const second = await check(agent2, workspace2a, propertyId, fixId, token2a);
    expect(second.status).toBe(first.status);
    expect(second.outcome.measuredAt).toBe(first.outcome.measuredAt);
    expect(second.outcome.after.clicks).toBe(130);
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
    // Baseline pin is stable across checks (never rewritten).
    expect((await app2.prisma.fix.findUnique({ where: { id: fixId } }))?.baselineSnapshotId).toBeDefined();
  });

  it("10. foreign property/workspace snapshots are never selected", async () => {
    const { propertyId, fixId } = await setupApplied(app2, agent2, workspace2a, token2a, "ms-t10a");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    // Post-window data exists — but only for ANOTHER property and ANOTHER workspace.
    const otherProp = await createPropertyRow(app2.prisma, { workspaceId: workspace2a, siteUrl: "sc-domain:ms-t10b.test" });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2a, propertyId: otherProp.id, siteUrl: otherProp.siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const otherWsProp = await createPropertyRow(app2.prisma, { workspaceId: workspace2b, siteUrl: "sc-domain:ms-t10c.test" });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2b, propertyId: otherWsProp.id, siteUrl: otherWsProp.siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const body = await check(agent2, workspace2a, propertyId, fixId, token2a);
    expect(body.status).toBe("data_delayed");
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
  });
});
