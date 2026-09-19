import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { MeasurementQueue, SWEEP_BATCH_SIZE } from "./measurement.queue";
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
 * Measurement queue reliability hardening (Prompt 5).
 *
 * Direct-mode (in-memory, no-timer) provider behavior is asserted through
 * the real provider methods; the BullMQ failure lifecycle (T4/T5) runs
 * against REAL Redis + REAL BullMQ on an isolated probe queue (no mocks —
 * library retry/exhaustion semantics are verified, not stubbed).
 *
 * Two app instances spread the per-app throttle budgets (global 60/min/IP).
 */
describe("Measurement queue reliability (Prompt 5)", () => {
  let app1: TestApp;
  let app2: TestApp;
  let queue1: MeasurementQueue;
  let queue2: MeasurementQueue;

  let agent1: any;
  let workspace1: string;
  let token1: string;
  let agent2: any;
  let workspace2: string;
  let token2: string;

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

  /** Setup-only legacy row: applied + elapsed + outcome-less, never scheduled. */
  async function createLegacyFix(
    app: TestApp,
    workspaceId: string,
    propertyId: string,
    id?: string,
  ): Promise<string> {
    const row = await app.prisma.fix.create({
      data: {
        id: id ?? randomUUID(),
        workspaceId,
        propertyId,
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
    return row.id;
  }

  function afterPage(clicks: number) {
    return { page: "/pricing", clicks, impressions: 2100, ctr: 0.035, position: 3.8 };
  }

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
        periodLabel: "Reliability probe",
        dataThrough: params.retrievedAt,
        retrievedAt: params.retrievedAt,
        freshness: "fresh",
        quality: "complete",
        limitations: [],
        normalizedJson: {
          meta: {
            source: { id: "google-search-console", label: "Google Search Console" },
            property: { id: params.propertyId, name: "example.com", type: "domain", siteUrl: params.siteUrl },
            period: { start: periodStart.toISOString(), end: params.retrievedAt.toISOString(), label: "Reliability probe" },
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
        rawResponseHash: `rel-probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        rowCount: 1,
      },
    });
  }

  beforeAll(async () => {
    app1 = await createTestApp();
    app2 = await createTestApp();
    await truncateAll(app1.prisma);
    queue1 = app1.app.get(MeasurementQueue);
    queue2 = app2.app.get(MeasurementQueue);
    const s1 = await signupAgent(app1.app, "rel-1");
    agent1 = s1.agent;
    workspace1 = s1.workspaceId;
    token1 = await csrfToken(agent1);
    const s2 = await signupAgent(app2.app, "rel-2");
    agent2 = s2.agent;
    workspace2 = s2.workspaceId;
    token2 = await csrfToken(agent2);
  });

  afterAll(async () => {
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
    await closeTestApp(app2);
  });

  it("T1. sweep is idempotent across repeated runs", async () => {
    const prop = await createPropertyRow(app1.prisma, { workspaceId: workspace1, siteUrl: "sc-domain:rel-t1.test" });
    const fixId = await createLegacyFix(app1, workspace1, prop.id);
    const first = await queue1.sweepEligible();
    expect(first.scanned).toBe(1);
    expect(first.scheduled).toBe(1);
    expect(first.batches).toBe(1);
    expect(first.hasMore).toBe(false);
    expect(queue1.getScheduledJobs().filter((e) => e.fixId === fixId)).toHaveLength(1);
    const second = await queue1.sweepEligible();
    expect(second.scheduled).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(1);
    expect(queue1.getScheduledJobs().filter((e) => e.fixId === fixId)).toHaveLength(1);
  });

  it("T2. concurrent sweeps create no duplicate active jobs", async () => {
    const prop = await createPropertyRow(app1.prisma, { workspaceId: workspace1, siteUrl: "sc-domain:rel-t2.test" });
    const fixId = await createLegacyFix(app1, workspace1, prop.id);
    const [a, b] = await Promise.all([queue1.sweepEligible(), queue1.sweepEligible()]);
    expect(queue1.getScheduledJobs().filter((e) => e.fixId === fixId)).toHaveLength(1);
    expect(a.scheduled + b.scheduled).toBe(1);
  });

  it("T3. sweep processes bounded batches with continuation to completion", async () => {
    const prop = await createPropertyRow(app1.prisma, { workspaceId: workspace1, siteUrl: "sc-domain:rel-t3.test" });
    const total = SWEEP_BATCH_SIZE * 2 + 50;
    const rows: Array<{ id: string; workspaceId: string; propertyId: string; page: string; status: "applied"; appliedAt: Date; expectedMeasurementDate: Date; measurementWindowDays: number }> = [];
    for (let i = 0; i < total; i += 1) {
      rows.push({
        id: randomUUID(),
        workspaceId: workspace1,
        propertyId: prop.id,
        page: "/pricing",
        status: "applied",
        appliedAt: new Date(Date.now() - 15 * 86400_000),
        expectedMeasurementDate: new Date(Date.now() - 1000 - i),
        measurementWindowDays: 14,
      });
    }
    await app1.prisma.fix.createMany({ data: rows });
    const before = queue1.getScheduledJobs().length;
    const first = await queue1.sweepEligible();
    // Bounded: fixed-size batches, never the whole set in one query.
    expect(first.batches).toBe(3);
    expect(first.scanned).toBeLessThanOrEqual(500);
    // Repeat calls continue safely (dedupe) until everything is scheduled…
    const second = await queue1.sweepEligible();
    expect(second.scheduled).toBe(0);
    const entries = queue1.getScheduledJobs().length - before;
    // …and every eligible row ends up scheduled exactly once.
    // (T1/T2 legacy rows were already scheduled: count only this batch.)
    const batchIds = new Set(rows.map((r) => r.id));
    const batchEntries = queue1.getScheduledJobs().filter((e) => batchIds.has(e.fixId));
    expect(batchEntries).toHaveLength(total);
    expect(entries).toBeGreaterThanOrEqual(total);
    void second;
  });

  it("T8. provider is a singleton and re-init is safe (one worker by design)", async () => {
    expect(app1.app.get(MeasurementQueue)).toBe(queue1);
    expect(app2.app.get(MeasurementQueue)).not.toBe(queue1);
    const before = queue1.getScheduledJobs().length;
    await expect(queue1.onModuleInit()).resolves.not.toThrow();
    expect(queue1.getScheduledJobs().length).toBe(before);
    // Test mode by design: no Worker process, no timers — direct execution.
    expect(queue1.getQueueHealth().worker).toBe("stopped");
    expect(queue1.getQueueHealth().status).toBe("disabled");
  });

  it("T9. shutdown is safe and idempotent", async () => {
    await expect(queue1.onModuleDestroy()).resolves.not.toThrow();
    await expect(queue1.onModuleDestroy()).resolves.not.toThrow();
    expect(queue1.getQueueHealth().worker).toBe("stopped");
    // Direct scheduling still works after destroy (queue was already null).
    const prop = await createPropertyRow(app1.prisma, { workspaceId: workspace1, siteUrl: "sc-domain:rel-t9.test" });
    const fixId = await createLegacyFix(app1, workspace1, prop.id);
    const r = await queue1.scheduleMeasurement(fixId, 0);
    expect(r.deduplicated).toBe(false);
    expect(queue1.getScheduledJobs().filter((e) => e.fixId === fixId)).toHaveLength(1);
  });

  it("T6. apply survives scheduling failure; later sweep recovers", async () => {
    const prop = await createPropertyRow(app1.prisma, { workspaceId: workspace1, siteUrl: "sc-domain:rel-t6.test" });
    await seedSignalSnapshot(app1.prisma, { workspaceId: workspace1, propertyId: prop.id, siteUrl: prop.siteUrl });
    await agent1.get(`/api/v1/workspaces/${workspace1}/properties/${prop.id}/recommendation`).expect(200);
    const fixRes = await agent1.get(`/api/v1/workspaces/${workspace1}/properties/${prop.id}/fix`).expect(200);
    const fixId = fixRes.body.fix.id as string;
    const spy = jest.spyOn(queue1, "scheduleMeasurement").mockRejectedValueOnce(new Error("redis down (simulated)"));
    try {
      // The Fix application itself must succeed despite the queue failure.
      await agent1
        .post(`/api/v1/workspaces/${workspace1}/properties/${prop.id}/fix/${fixId}/apply`)
        .set("x-csrf-token", token1)
        .send({})
        .expect(201);
    } finally {
      spy.mockRestore();
    }
    const row = await app1.prisma.fix.findUnique({ where: { id: fixId } });
    expect(row?.status).toBe("applied");
    expect(row?.baselineSnapshotId).toBeDefined();
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    // Recovery: once the window elapses, a later sweep reconstructs the job
    // from DB state (the sweep only handles elapsed windows by design).
    await app1.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 1000) } });
    await queue1.sweepEligible();
    expect(queue1.getScheduledJobs().filter((e) => e.fixId === fixId)).toHaveLength(1);
  });

  it("T7. sweep scheduling failure mutates no measurement state", async () => {
    const prop = await createPropertyRow(app1.prisma, { workspaceId: workspace1, siteUrl: "sc-domain:rel-t7.test" });
    const fixId = await createLegacyFix(app1, workspace1, prop.id);
    const spy = jest.spyOn(queue1, "scheduleMeasurement").mockRejectedValue(new Error("redis down (simulated)"));
    let result;
    try {
      result = await queue1.sweepEligible();
    } finally {
      spy.mockRestore();
    }
    expect(result.scheduled).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.batches).toBeGreaterThanOrEqual(1);
    expect(await app1.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect((await app1.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
  });

  it("T4. retryable failure retries with backoff, stays observable, fakes nothing", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2, token2, "rel-t4");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    // No post-window snapshot (seed is the pinned baseline) → deferred-data.
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const probeName = `p5-t4-${Date.now()}`;
    const probeRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const workerRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const probeQueue = new Queue<{ fixId: string }>(probeName, { connection: probeRedis });
    const probeWorker = new Worker<{ fixId: string }>(
      probeName,
      (job) => queue2.processMeasurementJob(job.data.fixId),
      { connection: workerRedis, concurrency: 1 },
    );
    const job = await probeQueue.add("measure", { fixId }, { attempts: 3, backoff: { type: "fixed", delay: 500 } });
    try {
      // Wait for BullMQ to exhaust the bounded attempts.
      const deadline = Date.now() + 30000;
      let state = await job.getState();
      while (state !== "failed" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        state = await job.getState();
      }
      expect(state).toBe("failed");
      const failed = await probeQueue.getFailed();
      expect(failed.some((j) => j.id === job.id)).toBe(true);
      const finished = await probeQueue.getJob(job.id!);
      expect((finished?.attemptsMade ?? 0)).toBeGreaterThanOrEqual(3);
      // Observable failure, but no fake outcome and a still-measurable Fix.
      expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
      expect((await app2.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
    } finally {
      await probeWorker.close().catch(() => {});
      await probeQueue.obliterate({ force: true }).catch(() => {});
      await probeQueue.close().catch(() => {});
      await probeRedis.quit().catch(() => {});
      await workerRedis.quit().catch(() => {});
    }
    void propertyId;
    void siteUrl;
  }, 60000);

  it("T5. permanent failure does not retry-loop", async () => {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const probeName = `p5-t5-${Date.now()}`;
    const probeRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const workerRedis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const probeQueue = new Queue<Record<string, never>>(probeName, { connection: probeRedis });
    const startedAt = Date.now();
    const probeWorker = new Worker(
      probeName,
      // Invalid payload (no fixId): the real provider path throws Unrecoverable.
      () => queue2.processMeasurementJob(undefined as unknown as string),
      { connection: workerRedis, concurrency: 1 },
    );
    const job = await probeQueue.add("measure", {}, { attempts: 5, backoff: { type: "fixed", delay: 1000 } });
    try {
      const deadline = Date.now() + 30000;
      let state = await job.getState();
      while (state !== "failed" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        state = await job.getState();
      }
      expect(state).toBe("failed");
      const finished = await probeQueue.getJob(job.id!);
      // Unrecoverable: failed fast without burning the configured attempts.
      expect(finished?.attemptsMade ?? 99).toBeLessThan(5);
      expect(Date.now() - startedAt).toBeLessThan(15000);
    } finally {
      await probeWorker.close().catch(() => {});
      await probeQueue.obliterate({ force: true }).catch(() => {});
      await probeQueue.close().catch(() => {});
      await probeRedis.quit().catch(() => {});
      await workerRedis.quit().catch(() => {});
    }
  }, 60000);

  it("T10. duplicate delivery → one FixOutcome only", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2, token2, "rel-t10");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    await queue2.processMeasurementJob(fixId);
    await queue2.processMeasurementJob(fixId);
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
  });

  it("T11. two providers (multi-instance) → one final outcome", async () => {
    const { propertyId, siteUrl, fixId } = await setupApplied(app2, agent2, workspace2, token2, "rel-t11");
    await app2.prisma.fix.update({ where: { id: fixId }, data: { expectedMeasurementDate: new Date(Date.now() - 3600_000) } });
    await writeSnapshot(app2.prisma, { workspaceId: workspace2, propertyId, siteUrl, retrievedAt: new Date(), page: afterPage(130) });
    // queue1 and queue2 are distinct provider instances over the same DB —
    // the closest in-process simulation of two API processes racing.
    const [a, b] = await Promise.all([queue1.processMeasurementJob(fixId), queue2.processMeasurementJob(fixId)]);
    expect(a.result).toBe("measured");
    expect(b.result).toBe("measured");
    expect(await app2.prisma.fixOutcome.count({ where: { fixId } })).toBe(1);
  });

  it("readiness exposes queue health without secrets", async () => {
    await queue1.sweepEligible();
    const res = await agent1.get("/api/v1/health/ready").expect(200);
    expect(res.body.db).toBe("ok");
    expect(res.body.measurementQueue).toBeDefined();
    expect(res.body.measurementQueue.status).toBe("disabled");
    expect(res.body.measurementQueue.worker).toBe("stopped");
    expect(res.body.measurementQueue.lastSweep).toBeDefined();
    expect(typeof res.body.measurementQueue.lastSweep.scanned).toBe("number");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/redis:\/\/|REDIS_URL|password|secret|token|Bearer/i);
  });
});
