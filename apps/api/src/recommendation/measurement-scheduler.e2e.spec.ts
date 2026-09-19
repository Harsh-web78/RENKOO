import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { SchedulerRegistry } from "@nestjs/schedule";
import { MeasurementQueue, SWEEP_MAX_PER_RUN } from "./measurement.queue";
import {
  TestApp,
  createTestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
  createPropertyRow,
} from "../test-utils/e2e-fixtures";

/**
 * Hourly recovery sweep trigger (Prompt 6).
 *
 * NODE_ENV=test never registers the real hourly timer (ScheduleModule is
 * absent from the test module graph — proven by T5), so every test below
 * invokes `runMeasurementRecoverySweep()` directly: the same method the
 * hourly tick calls in production. T6 additionally proves the production
 * convergence mechanism (deterministic ids) against REAL Redis + BullMQ.
 */
describe("Measurement recovery scheduler (Prompt 6)", () => {
  let app: TestApp;
  let queue: MeasurementQueue;
  let workspaceId: string;

  /** Setup-only legacy row: applied + elapsed + outcome-less, never scheduled. */
  async function createLegacyFix(propertyId: string): Promise<string> {
    const row = await app.prisma.fix.create({
      data: {
        id: randomUUID(),
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

  async function createProperty(tag: string) {
    return createPropertyRow(app.prisma, { workspaceId, siteUrl: `sc-domain:${tag}.test` });
  }

  beforeAll(async () => {
    app = await createTestApp();
    await truncateAll(app.prisma);
    queue = app.app.get(MeasurementQueue);
    ({ workspaceId } = await signupAgent(app.app, "sched"));
  });

  afterAll(async () => {
    await truncateAll(app.prisma);
    await closeTestApp(app);
  });

  it("T1. scheduled method invokes sweepEligible exactly once (scheduled trigger)", async () => {
    const spy = jest.spyOn(queue, "sweepEligible");
    try {
      const res = await queue.runMeasurementRecoverySweep();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(SWEEP_MAX_PER_RUN, "scheduled");
      expect(res).toMatchObject({ trigger: "scheduled" });
      expect(queue.getQueueHealth().lastSweep?.trigger).toBe("scheduled");
    } finally {
      spy.mockRestore();
    }
  });

  it("T2. successful sweep logs structured metrics", async () => {
    const prop = await createProperty(tagId("t2"));
    const fixId = await createLegacyFix(prop.id);
    const result = { scanned: 1, eligible: 1, scheduled: 1, skipped: 0, batches: 1, hasMore: false };
    const sweepMock = jest.spyOn(queue, "sweepEligible").mockResolvedValue(result);
    const logSpy = jest.spyOn((queue as unknown as { logger: { log: (...args: unknown[]) => void } }).logger, "log");
    try {
      await queue.runMeasurementRecoverySweep();
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      const metric = lines.find((l) => l.includes("measure recovery sweep") && l.includes("trigger=scheduled"));
      expect(metric).toBeDefined();
      expect(metric).toContain("scanned=1");
      expect(metric).toContain("scheduled=1");
      expect(metric).toContain("hasMore=false");
    } finally {
      sweepMock.mockRestore();
      logSpy.mockRestore();
    }
    expect(await app.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
  });

  it("T3. sweep failure is contained: no throw, no DB mutation", async () => {
    const prop = await createProperty(tagId("t3"));
    const fixId = await createLegacyFix(prop.id);
    const sweepMock = jest.spyOn(queue, "sweepEligible").mockRejectedValue(new Error("db down (simulated)"));
    const warnSpy = jest.spyOn((queue as unknown as { logger: { warn: (...args: unknown[]) => void } }).logger, "warn");
    try {
      const res = await queue.runMeasurementRecoverySweep();
      expect(res).toMatchObject({ trigger: "scheduled", failed: true });
      const lines = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("measure recovery sweep") && l.includes("trigger=scheduled"))).toBe(true);
    } finally {
      sweepMock.mockRestore();
      warnSpy.mockRestore();
    }
    expect(await app.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect((await app.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
  });

  it("T4. overlapping scheduled runs do not pile up", async () => {
    let release!: (value: { scanned: number; eligible: number; scheduled: number; skipped: number; batches: number; hasMore: boolean }) => void;
    const gate = new Promise<{ scanned: number; eligible: number; scheduled: number; skipped: number; batches: number; hasMore: boolean }>(
      (resolve) => {
        release = resolve;
      },
    );
    const sweepMock = jest.spyOn(queue, "sweepEligible").mockReturnValue(gate);
    try {
      const first = queue.runMeasurementRecoverySweep();
      const second = await queue.runMeasurementRecoverySweep();
      expect(second).toMatchObject({ trigger: "scheduled", skipped: "overlap" });
      release({ scanned: 0, eligible: 0, scheduled: 0, skipped: 0, batches: 0, hasMore: false });
      const firstRes = await first;
      expect(firstRes).toMatchObject({ trigger: "scheduled" });
      expect(sweepMock).toHaveBeenCalledTimes(1);
      // Guard released: the next execution runs normally again.
      const third = await queue.runMeasurementRecoverySweep();
      expect(sweepMock).toHaveBeenCalledTimes(2);
      expect(third).toMatchObject({ trigger: "scheduled" });
    } finally {
      sweepMock.mockRestore();
    }
  });

  it("T5. no real hourly timer exists in test mode", () => {
    // ScheduleModule is absent from the test module graph, so @Cron is
    // inert metadata: no SchedulerRegistry provider, no registered jobs.
    expect(() => app.app.get(SchedulerRegistry)).toThrow();
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("T6. concurrent schedulers converge to one active job (real Redis)", async () => {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const queueName = `p6-t6-${Date.now()}`;
    const redisA = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const redisB = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    const queueA = new Queue<{ fixId: string }>(queueName, { connection: redisA });
    const queueB = new Queue<{ fixId: string }>(queueName, { connection: redisB });
    const fixId = `p6-fix-${randomUUID()}`;
    try {
      // Two "processes" schedule the same deterministic id concurrently.
      // Whichever duplicate-id semantic BullMQ applies (reject or return
      // existing), one Redis key means one job record: convergence holds.
      const results = await Promise.allSettled([
        queueA.add("measure", { fixId }, { jobId: `measure-${fixId}`, attempts: 6 }),
        queueB.add("measure", { fixId }, { jobId: `measure-${fixId}`, attempts: 6 }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled").length;
      expect(fulfilled).toBeGreaterThanOrEqual(1);
      const delayed = await queueA.getDelayed();
      const waiting = await queueA.getWaiting();
      const mine = [...delayed, ...waiting].filter((j) => (j.data as { fixId: string }).fixId === fixId);
      expect(mine).toHaveLength(1);
    } finally {
      await queueA.obliterate({ force: true }).catch(() => {});
      await queueA.close().catch(() => {});
      await queueB.close().catch(() => {});
      await redisA.quit().catch(() => {});
      await redisB.quit().catch(() => {});
    }
  }, 60000);

  it("T7. Redis/queue failure during scheduled sweep is contained", async () => {
    const prop = await createProperty(tagId("t7"));
    const fixId = await createLegacyFix(prop.id);
    const spy = jest.spyOn(queue, "scheduleMeasurement").mockRejectedValue(new Error("redis down (simulated)"));
    try {
      const res = await queue.runMeasurementRecoverySweep();
      expect(res).toMatchObject({ trigger: "scheduled" });
      expect("scheduled" in res && (res as { scheduled: number }).scheduled).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await app.prisma.fixOutcome.count({ where: { fixId } })).toBe(0);
    expect((await app.prisma.fix.findUnique({ where: { id: fixId } }))?.status).toBe("applied");
  });

  it("T8. test-mode init performs no sweep; direct sweep stays manual", async () => {
    const before = queue.getScheduledJobs().length;
    await expect(queue.onModuleInit()).resolves.not.toThrow();
    expect(queue.getScheduledJobs().length).toBe(before);
    // The bootstrap code path is unchanged (redis branch untouched); the
    // direct method keeps its default manual trigger for tooling/calls.
    const direct = await queue.sweepEligible(10, "manual");
    expect(queue.getQueueHealth().lastSweep?.trigger).toBe("manual");
    expect(typeof direct.scanned).toBe("number");
  });
});

/** Unique siteUrl tags without relying on test-order state. */
function tagId(tag: string): string {
  return `sched-${tag}-${Date.now().toString(36)}`;
}
