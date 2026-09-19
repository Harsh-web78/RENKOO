import { MeasurementQueue } from "./measurement.queue";
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
 * Automatic measurement worker (Prompt 4).
 *
 * The queue runs in direct (in-memory, no-timer) mode under NODE_ENV=test —
 * the same fallback pattern as IngestionQueue — so scheduling intent is
 * asserted via `getScheduledJobs()` while `processMeasurementJob` executes
 * the REAL shared measurement core against the test database. No BullMQ
 * wire behavior is mocked: payload shape, eligibility, selection,
 * idempotency, and isolation are all exercised for real.
 *
 * Two app instances spread the per-app throttle budgets (global 60/min/IP).
 */
describe("Measurement worker (Prompt 4)", () => {
  let app1: TestApp;
  let app2: TestApp;
  let queue1: MeasurementQueue;
  let queue2: MeasurementQueue;

  async function writeSnapshot(
    prisma: TestApp["prisma"],
    params: {
      workspaceId: string;
      propertyId: string;
      siteUrl: string;
      retrievedAt: Date;
      page: { page: string; clicks: number; impressions: number; ctr: number; position: number };
    },
  ): Promise<void> {
    const periodStart = new Date(params.retrievedAt.getTime() - 28 * 24 * 60 * 60 * 1000);
    await prisma.searchDataSnapshot.create({
      data: {
        workspaceId: params.workspaceId,
        propertyId: params.propertyId,
        siteUrl: params.siteUrl,
        periodStart,
        periodEnd: params.retrievedAt,
        periodLabel: "Worker probe",
        dataThrough: params.retrievedAt,
        retrievedAt: params.retrievedAt,
        freshness: "fresh",
        quality: "complete",
        limitations: [],
        normalizedJson: {
          meta: {
            source: { id: "google-search-console", label: "Google Search Console" },
            property: { id: params.propertyId, name: "example.com", type: "domain", siteUrl: params.siteUrl },
            period: { start: periodStart.toISOString(), end: params.retrievedAt.toISOString(), label: "Worker probe" },
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
        rawResponseHash: `worker-probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        rowCount: 1,
      },
    });
  }

  /** Apply via HTTP (also schedules) and return handles. */
  async function setupApplied(
    app: TestApp,
    agent: any,
    workspaceId: string,
    token: string,
    tag: string,
  ): Promise<{ propertyId: string; siteUrl: string; fixId: string }> {
    const prop = await createPropertyRow(app.prisma, { workspaceId, siteUrl: `sc-domain:${tag}.test` });
    await seedSignalSnapshot(app.prisma, { workspaceId, propertyId: prop.id, siteUrl: prop.siteUrl });
    await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/recommendation`).expect(200);
    const fixRes = await agent.get(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix`).expect(200);
    const fixId = fixRes.body.fix.id as string;
    await agent
      .post(`/api/v1/workspaces/${workspaceId}/properties/${prop.id}/fix/${fixId}/apply`)
      .set("x-csrf-token", token)
      .send({})
      .expect(201);
    return { propertyId: prop.id, siteUrl: prop.siteUrl, fixId };
  }

  function afterPage(clicks: number) {
    return { page: "/pricing", clicks, impressions: 2100, ctr: 0.035, position: 3.8 };
  }

  let agent1: any;
  let workspace1: string;
  let token1: string;
  let agent2: any;
  let workspace2: string;
  let token2: string;

  beforeAll(async () => {
    app1 = await createTestApp();
    app2 = await createTestApp();
    await truncateAll(app1.prisma);
    queue1 = app1.app.get(MeasurementQueue);
    queue2 = app2.app.get(MeasurementQueue);
    const s1 = await signupAgent(app1.app, "worker-1");
    agent1 = s1.agent;
    workspace1 = s1.workspaceId;
    token1 = await csrfToken(agent1);
    const s2 = await signupAgent(app2.app, "worker-2");
    agent2 = s2.agent;
    workspace2 = s2.workspaceId;
    token2 = await csrfToken(agent2);
  });

  afterAll(async () => {
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
    await closeTestApp(app2);
  });

  it("T1. apply schedules exactly one job with fixId-only payload", async () => {
    const { fixId } = await setupApplied(app1, agent1, workspace1, token1, "mw-t1");
    const entries = queue1.getScheduledJobs().filter((e) => e.fixId === fixId);
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]!.data).sort()).toEqual(["fixId"]);
    expect(entries[0]!.data.fixId).toBe(fixId);
    // Scheduling is idempotent: a second schedule call deduplicates.
    const again = await queue1.scheduleMeasurement(fixId, 0);
    expect(again.deduplicated).toBe(true);
    expect(queue1.getScheduledJobs().filter((e) => e.fixId === fixId)).toHaveLength(1);
  });

  it("T2. worker before the window → deferred, no outcome, still measurable", async () => {
    const { fixId } = await setupApplied(app1, agent1, workspace1, token1, "mw-t2");
    const res = await queue1.processMeasurementJob(fixId);
    expect(res.result).toBe("deferred-window");
    if (res.result === "deferred-window") expect(res.rescheduled).toBe(true);
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect((await app1.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
  });

  it("T3. worker with valid post-window snapshot → B selected, one outcome", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app1, agent1, workspace1, token1, "mw-t3");
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app1.prisma, { workspaceId: workspace1, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const res = await queue1.processMeasurementJob(fixId);
    expect(res.result).toBe("measured");
    if (res.result === "measured") {
      expect(res.status).toBe("positive-change");
      expect(res.outcome.after.clicks).toBe(130);
      expect(res.outcome.before.clicks).toBe(60);
    }
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
  });

  it("T4. window elapsed, no qualifying snapshot → retryable, no fake outcome", async () => {
    const { fixId } = await setupApplied(app1, agent1, workspace1, token1, "mw-t4");
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await expect(queue1.processMeasurementJob(fixId)).rejects.toThrow(/not available yet/);
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect((await app1.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
  });

  it("T5. worker selects the earliest qualifying snapshot (Prompt 3 preserved)", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app1, agent1, workspace1, token1, "mw-t5");
    const now = Date.now();
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(now - 21 * 86400_000) } });
    await writeSnapshot(app1.prisma, {
      workspaceId: workspace1, propertyId, siteUrl,
      retrievedAt: new Date(now - 7 * 86400_000),
      page: afterPage(130),
    });
    await writeSnapshot(app1.prisma, {
      workspaceId: workspace1, propertyId, siteUrl,
      retrievedAt: new Date(now),
      page: afterPage(200),
    });
    const res = await queue1.processMeasurementJob(fixId);
    expect(res.result).toBe("measured");
    if (res.result === "measured") expect(res.outcome.after.clicks).toBe(130);
  });

  it("T6+T13. duplicate delivery and re-delivery → exactly one outcome", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app1, agent1, workspace1, token1, "mw-t6");
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app1.prisma, { workspaceId: workspace1, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const first = await queue1.processMeasurementJob(fixId);
    const second = await queue1.processMeasurementJob(fixId);
    const third = await queue1.processMeasurementJob(fixId);
    expect(first.result).toBe("measured");
    expect(second.result).toBe("measured");
    expect(third.result).toBe("measured");
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
  });

  it("T7. worker-then-manual race → exactly one outcome", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2, token2, "mw-t7");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const auto = await queue2.processMeasurementJob(fixId);
    const manual = await agent2
      .post(`/api/v1/workspaces/${workspace2}/properties/${propertyId}/fix/${fixId}/check`)
      .set("x-csrf-token", token2)
      .send({})
      .expect(201);
    expect(auto.result).toBe("measured");
    if (auto.result === "measured") {
      // HTTP serializes measuredAt to an ISO string while the direct worker
      // call carries a Date — compare instants, not representations.
      expect(new Date(manual.body.outcome.measuredAt).getTime()).toBe(new Date(auto.outcome.measuredAt).getTime());
      expect(manual.body.outcome.after.clicks).toBe(130);
    }
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
  });

  it("T8. existing outcome → no recalculation, no duplicate", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2, token2, "mw-t8");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const manual = await agent2
      .post(`/api/v1/workspaces/${workspace2}/properties/${propertyId}/fix/${fixId}/check`)
      .set("x-csrf-token", token2)
      .send({})
      .expect(201);
    // A much newer, much larger snapshot arrives — the recorded outcome stands.
    await writeSnapshot(app2.prisma, {
      workspaceId: workspace2, propertyId, siteUrl,
      retrievedAt: new Date(Date.now() + 1000),
      page: afterPage(999),
    });
    const res = await queue2.processMeasurementJob(fixId);
    expect(res.result).toBe("measured");
    if (res.result === "measured") {
      expect(new Date(res.outcome.measuredAt).getTime()).toBe(new Date(manual.body.outcome.measuredAt).getTime());
      expect(res.outcome.after.clicks).toBe(130);
    }
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
  });

  it("T9. dismissed/superseded Fixes are never measured", async () => {
    const { propertyId, fixId } = await setupApplied(app2, agent2, workspace2, token2, "mw-t9");
    await agent2
      .post(`/api/v1/workspaces/${workspace2}/properties/${propertyId}/fix/${fixId}/dismiss`)
      .set("x-csrf-token", token2)
      .send({})
      .expect(201);
    const dismissed = await queue2.processMeasurementJob(fixId);
    expect(dismissed.result).toBe("skipped");
    const ghost = await app2.prisma.fix.create({
      data: { workspaceId: workspace2, propertyId, page: "/pricing", status: "superseded" },
    });
    const superseded = await queue2.processMeasurementJob(ghost.id);
    expect(superseded.result).toBe("skipped");
    const missing = await queue2.processMeasurementJob("cuid-that-does-not-exist-0000");
    expect(missing.result).toBe("skipped");
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect(await app2.prisma.fixOutcome.count({ where: { fixId: ghost.id } })).toBe(0);
  });

  it("T10+T11. foreign workspace/property snapshots are never selected", async () => {
    const { propertyId, fixId } = await setupApplied(app2, agent2, workspace2, token2, "mw-t10");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    const otherProp = await createPropertyRow(app2.prisma, { workspaceId: workspace2, siteUrl: "sc-domain:mw-t10b.test" });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2, propertyId: otherProp.id, siteUrl: otherProp.siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const { agent: agentB, workspaceId: wsB } = await signupAgent(app2.app, "worker-iso-b");
    const wsBProp = await createPropertyRow(app2.prisma, { workspaceId: wsB, siteUrl: "sc-domain:mw-t10c.test" });
    await writeSnapshot(app2.prisma, { workspaceId: wsB, propertyId: wsBProp.id, siteUrl: wsBProp.siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    await expect(queue2.processMeasurementJob(fixId)).rejects.toThrow(/not available yet/);
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    void agentB;
  });

  it("T12. worker-measured outcome appears through existing History", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2, token2, "mw-t12");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    const res = await queue2.processMeasurementJob(fixId);
    expect(res.result).toBe("measured");
    // No new history mechanism: the derived history shows the measured fix.
    const history = await agent2.get(`/api/v1/workspaces/${workspace2}/history`).expect(200);
    const entry = (history.body.items as any[]).find((i) => i.id === fixId);
    expect(entry).toBeDefined();
    expect(entry.status).toBe("measured");
    expect(entry.outcome).toBeDefined();
    expect(entry.outcome.after.clicks).toBe(130);
  });

  it("sweep enqueues eligible legacy Fixes once, then deduplicates", async () => {
    // Setup-only legacy row: applied + elapsed + outcome-less, never scheduled.
    const legacyProp = await createPropertyRow(app2.prisma, { workspaceId: workspace2, siteUrl: "sc-domain:mw-sweep.test" });
    const legacy = await app2.prisma.fix.create({
      data: {
        workspaceId: workspace2,
        propertyId: legacyProp.id,
        page: "/pricing",
        status: "applied",
        appliedAt: new Date(Date.now() - 15 * 86400_000),
        expectedMeasurementDate: new Date(Date.now() - 1000),
        measurementWindowDays: 14,
        baselineClicks: 60,
        baselineCtr: "2.0%",
        baselinePosition: 4.5,
        baselineCapturedAt: new Date(Date.now() - 15 * 86400_000),
      },
    });
    const first = await queue2.sweepEligible(500);
    expect(first.scheduled).toBeGreaterThanOrEqual(1);
    expect(queue2.getScheduledJobs().filter((e) => e.fixId === legacy.id)).toHaveLength(1);
    const second = await queue2.sweepEligible(500);
    expect(queue2.getScheduledJobs().filter((e) => e.fixId === legacy.id)).toHaveLength(1);
    expect(second.scheduled).toBe(0);
  });
});
