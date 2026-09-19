import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, SchedulerRegistry } from "@nestjs/schedule";
import { Queue, Worker, QueueEvents, JobsOptions, UnrecoverableError } from "bullmq";
import IORedis from "ioredis";
import { PrismaService } from "../prisma/prisma.service";
import { RecommendationService } from "./recommendation.service";

/**
 * Automatic Fix measurement queue (Prompt 4; hardened Prompt 5).
 *
 * Same architecture as IngestionQueue (BullMQ + the shared Redis URL, Queue +
 * QueueEvents, test-env direct fallback) — no second queue system:
 *   - apply enqueues ONE delayed job per Fix (`delay` = stored
 *     `expectedMeasurementDate - now`, so the 14-day window keeps exactly one
 *     definition);
 *   - a BullMQ Worker runs the shared `measureById` core (Prompt 3 rules);
 *   - `sweepEligible()` reconciles pre-Prompt-4 / lost / failed jobs in
 *     bounded batches and runs at bootstrap (no production cron invented).
 *
 * Durability model (Prompt 5): Redis owns transient job state, PostgreSQL
 * owns business state (DB authoritative). Delayed jobs survive worker
 * restarts inside Redis (persistence is a deployment concern — see
 * docker-compose AOF note); anything lost is reconstructible because the
 * sweep re-derives jobs from `applied + outcome-less + window elapsed`.
 * Job ids are deterministic per Fix (`measure-<fixId>`), so concurrent
 * schedulers converge instead of stacking duplicates.
 *
 * Payloads carry ONLY `{ fixId }` — never baselines, prose, snapshots,
 * tokens, or secrets. Logs carry only safe identifiers.
 */

export interface MeasureJobData {
  fixId: string;
}

export const MEASUREMENT_QUEUE_NAME = "measurement";

/**
 * Hourly recovery sweep (Prompt 6): the delayed BullMQ job owns normal
 * timing; this cron is only the safety net for lost/failed/missed jobs.
 * Exactly hourly — never more frequent.
 */
export const MEASURE_SWEEP_CRON_EXPRESSION = "0 * * * *";
export const MEASURE_SWEEP_CRON_NAME = "measurement-recovery-sweep";

/** Where a sweep was triggered from (readiness can distinguish them). */
export type SweepTrigger = "bootstrap" | "scheduled" | "manual";

/** Bounded retries for genuinely temporary lack of data/failures. */
export const MEASURE_MAX_ATTEMPTS = 6;
/** Exponential base: retries at ~1h, 2h, 4h, 8h, 16h, 32h after the window fire. */
export const MEASURE_BACKOFF_MS = 3_600_000;

/**
 * Sweep bounds (Prompt 5): bounded batches cap memory; the per-run cap keeps
 * the post-downtime burst identical to the Prompt 4 total (500). Callers
 * needing more use the returned `hasMore` continuation (repeat calls are
 * safe via schedule dedupe).
 */
export const SWEEP_BATCH_SIZE = 100;
export const SWEEP_MAX_PER_RUN = 500;
/** Post-downtime burst stagger: +500ms per position (max ~4min across a run). */
const SWEEP_STAGGER_MS = 500;

export interface SweepResult {
  scanned: number;
  eligible: number;
  scheduled: number;
  skipped: number;
  batches: number;
  hasMore: boolean;
}

export interface QueueHealth {
  status: "ready" | "disabled";
  worker: "running" | "stopped";
  lastSweep: (SweepResult & { at: string; trigger: SweepTrigger }) | null;
}

interface ScheduledEntry {
  jobId: string;
  /** Mirrors the BullMQ job payload ({ fixId } only) for test assertions. */
  data: MeasureJobData;
  fixId: string;
  runAt: number;
}

@Injectable()
export class MeasurementQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MeasurementQueue.name);
  private queue: Queue<MeasureJobData> | null = null;
  private queueEvents: QueueEvents | null = null;
  private worker: Worker<MeasureJobData> | null = null;
  private redis: IORedis | null = null;
  private isReady = false;
  private directMode = false;
  /** Test-mode scheduled-job log (no timers, no Redis — inspectable intent). */
  private scheduledLog: ScheduledEntry[] = [];
  private lastSweep: (SweepResult & { at: string; trigger: SweepTrigger }) | null = null;
  /**
   * In-process overlap guard (Prompt 6, Part 11): skips a scheduled tick
   * while a previous sweep is still running in THIS process. Optimization
   * only — cross-instance correctness still comes from deterministic job
   * ids, live-scan dedupe, and FixOutcome uniqueness.
   */
  private sweepRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly measurements: RecommendationService,
    // Present only when ScheduleModule is loaded (production/dev — never in
    // tests); @Optional keeps the provider constructible without it.
    @Optional() private readonly schedulerRegistry?: SchedulerRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.config.get<string>("NODE_ENV", "development");
    if (nodeEnv === "test") {
      this.directMode = true;
      this.logger.log("MeasurementQueue direct mode in test env — scheduling recorded in-memory, no timers");
      return;
    }
    const redisUrl = this.config.get<string>("REDIS_URL", "");
    if (!redisUrl) {
      this.logger.warn("REDIS_URL not set — measurement queue disabled (manual checkFix still works)");
      return;
    }
    try {
      this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
      this.redis.on("error", (err) => this.logger.warn(`MeasurementQueue Redis error: ${err}`));
      await this.redis.ping().catch(() => {
        this.logger.warn("MeasurementQueue Redis ping failed — queue disabled");
        this.redis = null;
      });
      if (!this.redis) return;

      this.queue = new Queue<MeasureJobData>(MEASUREMENT_QUEUE_NAME, { connection: this.redis });
      this.queueEvents = new QueueEvents(MEASUREMENT_QUEUE_NAME, { connection: this.redis.duplicate() });
      this.worker = new Worker<MeasureJobData>(MEASUREMENT_QUEUE_NAME, (job) => this.runJob(job.id, job.data), {
        connection: this.redis.duplicate(),
        concurrency: 2,
      });
      this.worker.on("completed", (job, result: unknown) => {
        const category = (result as { result?: string } | undefined)?.result ?? "ok";
        this.logger.log(`measure completed jobId=${job?.id} fixId=${job?.data?.fixId} result=${category}`);
      });
      this.worker.on("failed", (job, err) => {
        this.logger.warn(
          `measure failed jobId=${job?.id} fixId=${job?.data?.fixId} attemptsMade=${job?.attemptsMade ?? 0}/${MEASURE_MAX_ATTEMPTS} retryable=${(job?.attemptsMade ?? 0) < MEASURE_MAX_ATTEMPTS} err=${err instanceof Error ? err.message : String(err)}`,
        );
      });
      this.isReady = true;
      this.logger.log("MeasurementQueue ready (worker + sweep)");
      await this.sweepEligible(SWEEP_MAX_PER_RUN, "bootstrap").catch((e) => {
        this.logger.warn(`Measurement sweep at bootstrap failed (manual checkFix unaffected): ${e instanceof Error ? e.message : String(e)}`);
      });
    } catch (e) {
      this.logger.warn(`MeasurementQueue init failed: ${e}`);
      this.queue = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Stop the hourly trigger first so no new sweep starts during teardown
    // (@nestjs/schedule does not auto-clear cron jobs on destroy).
    if (this.schedulerRegistry?.doesExist("cron", MEASURE_SWEEP_CRON_NAME)) {
      this.schedulerRegistry.deleteCronJob(MEASURE_SWEEP_CRON_NAME);
    }
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
    await this.queueEvents?.close().catch(() => {});
    await this.redis?.quit().catch(() => {});
    this.worker = null;
    this.queue = null;
    this.queueEvents = null;
    this.redis = null;
    this.isReady = false;
  }

  isQueueReady(): boolean {
    return this.isReady && !!this.queue;
  }

  /**
   * Zero-I/O queue health for readiness probes (Part 9): provider-known
   * state only — no Fix queries, no Redis ping, no secrets.
   */
  getQueueHealth(): QueueHealth {
    return {
      status: this.isQueueReady() ? "ready" : "disabled",
      worker: this.worker ? "running" : "stopped",
      lastSweep: this.lastSweep,
    };
  }

  /** Test-only: inspect scheduled intent in direct (test) mode. */
  getScheduledJobs(): ScheduledEntry[] {
    return [...this.scheduledLog];
  }

  private liveFixIds(): Promise<Set<string>> | Set<string> {
    if (!this.queue) return new Set(this.scheduledLog.map((e) => e.fixId));
    return this.queue
      .getJobs(["delayed", "waiting", "active"])
      .then((jobs) => new Set(jobs.map((j) => (j.data as MeasureJobData | undefined)?.fixId).filter((id): id is string => !!id)))
      .catch(() => new Set<string>());
  }

  /**
   * Schedule one measurement run for a Fix. Idempotent across processes:
   * a live (delayed/waiting/active) job carrying the same fixId is reused,
   * and the deterministic job id makes concurrent schedulers converge
   * (BullMQ duplicate-id add is resolved by inspecting the existing job:
   * live → reuse, failed → remove + re-add once for recovery, completed →
   * reuse as already-handled). Double apply / repeated sweeps therefore
   * never stack duplicate active jobs — no DB scheduling table needed.
   *
   * `opts.jobId` overrides the deterministic id for cases that must coexist
   * with a live job (pre-window re-enqueue while the firing job is active).
   */
  async scheduleMeasurement(
    fixId: string,
    delayMs = 0,
    opts: { jobId?: string; expectedMeasurementDate?: Date; dedupe?: boolean } = {},
  ): Promise<{ jobId: string; queued: boolean; deduplicated: boolean }> {
    if (!fixId || typeof fixId !== "string") {
      throw new Error("scheduleMeasurement requires a fixId string");
    }
    const safeDelay = Number.isFinite(delayMs) && delayMs > 0 ? Math.floor(delayMs) : 0;
    const jobId = opts.jobId ?? `measure-${fixId}`;
    // The pre-window re-enqueue intentionally bypasses fixId dedupe (it
    // supersedes the firing job); its window-scoped id still converges
    // duplicates via the per-id handling below.
    const dedupe = opts.dedupe ?? true;
    const expectedLog = opts.expectedMeasurementDate ? ` expected=${opts.expectedMeasurementDate.toISOString()}` : "";
    if (dedupe) {
      const live = await this.liveFixIds();
      if (live.has(fixId)) {
        this.logger.log(`measure already scheduled fixId=${fixId}${expectedLog} — skipping duplicate`);
        return { jobId: `existing-${fixId}`, queued: true, deduplicated: true };
      }
    }
    if (!this.queue) {
      // Direct mode (tests) or Redis unavailable: record intent in-memory.
      // No timers are created — tests drive `processMeasurementJob` directly.
      // The check-and-push below is synchronous (no await between), so
      // concurrent schedulers in one process converge atomically here; the
      // Redis path converges via deterministic ids + the catch handling.
      if (dedupe && this.scheduledLog.some((e) => e.fixId === fixId)) {
        this.logger.log(`measure already scheduled fixId=${fixId}${expectedLog} — skipping duplicate`);
        return { jobId: `existing-${fixId}`, queued: false, deduplicated: true };
      }
      const entry: ScheduledEntry = { jobId: `direct-${jobId}-${Date.now()}`, data: { fixId }, fixId, runAt: Date.now() + safeDelay };
      this.scheduledLog.push(entry);
      this.logger.log(`measure scheduled (direct) fixId=${fixId} delayMs=${safeDelay}${expectedLog}`);
      return { jobId: entry.jobId, queued: false, deduplicated: false };
    }
    const jobOpts: JobsOptions = {
      delay: safeDelay,
      attempts: MEASURE_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: MEASURE_BACKOFF_MS },
      // Bounded retention: failed jobs stay observable for diagnosis (500),
      // completed churn is trimmed (100) — never unbounded (Part 6).
      removeOnComplete: 100,
      removeOnFail: 500,
      // BullMQ rejects custom jobIds containing ":" — dashes only.
      jobId,
    };
    try {
      const job = await this.queue.add("measure", { fixId }, jobOpts);
      this.logger.log(`measure scheduled fixId=${fixId} delayMs=${safeDelay}${expectedLog} jobId=${job.id}`);
      return { jobId: job.id ?? jobId, queued: true, deduplicated: false };
    } catch (e) {
      // Lost race with a concurrent scheduler holding the same id.
      const existing = await this.queue.getJob(jobId).catch(() => null);
      const state = existing ? await existing.getState().catch(() => null) : null;
      if (state === "failed") {
        // Recovery (Part 3): a dead record must not block re-scheduling —
        // remove it and enqueue fresh exactly once.
        await existing!.remove().catch(() => {});
        try {
          const retry = await this.queue.add("measure", { fixId }, { ...jobOpts, jobId: `${jobId}-r${Date.now()}` });
          this.logger.log(`measure rescheduled after failed record fixId=${fixId} jobId=${retry.id}`);
          return { jobId: retry.id ?? jobId, queued: true, deduplicated: false };
        } catch (e2) {
          this.logger.warn(`measure reschedule failed fixId=${fixId}: ${e2 instanceof Error ? e2.message : String(e2)}`);
          throw e2;
        }
      }
      if (existing) {
        // Live (delayed/waiting/active/…) or already completed: converge on
        // the existing record instead of stacking a duplicate.
        this.logger.log(`measure already scheduled fixId=${fixId} state=${state} (race) — skipping duplicate`);
        return { jobId: existing.id ?? `existing-${fixId}`, queued: true, deduplicated: true };
      }
      throw e;
    }
  }

  /**
   * Execute one measurement job (BullMQ processor AND direct test entry).
   * Returns the shared-core category; throws ONLY for retryable conditions
   * (temporary data lack, transient failures) so BullMQ bounded attempts
   * apply. Permanent outcomes return success and are never retried.
   */
  async processMeasurementJob(
    fixId: string,
  ): Promise<
    | { result: "measured"; status: string; outcome?: any }
    | { result: "deferred-window"; rescheduled: boolean; expectedMeasurementDate: Date }
    | { result: "skipped"; reason: string }
  > {
    if (!fixId || typeof fixId !== "string") {
      throw new UnrecoverableError("measure job payload must contain a fixId string");
    }
    const res = await this.measurements.measureById(fixId);
    if (res.result === "deferred-window") {
      // Early fire (clock skew/tests): re-enqueue for the exact window end
      // instead of burning retry attempts, then succeed. The re-enqueue uses
      // a window-scoped id so it coexists with the (active, completing)
      // firing job instead of colliding with it.
      const delayMs = Math.max(0, res.expectedMeasurementDate.getTime() - Date.now());
      const re = await this.scheduleMeasurement(fixId, delayMs, {
        jobId: `measure-${fixId}-w${res.expectedMeasurementDate.getTime()}`,
        expectedMeasurementDate: res.expectedMeasurementDate,
        dedupe: false,
      });
      this.logger.log(`measure deferred to window fixId=${fixId} delayMs=${delayMs} expected=${res.expectedMeasurementDate.toISOString()} rescheduled=${!re.deduplicated}`);
      return { result: "deferred-window", rescheduled: !re.deduplicated, expectedMeasurementDate: res.expectedMeasurementDate };
    }
    if (res.result === "deferred-data") {
      // Window elapsed but no valid after snapshot yet — genuinely temporary:
      // throw so BullMQ bounded attempts retry later. Nothing was persisted,
      // the Fix stays measurable, and the sweep remains a backstop.
      this.logger.log(`measure deferred (data not yet available) fixId=${fixId}`);
      throw new Error(`measure deferred: post-window snapshot not available yet (fixId=${fixId})`);
    }
    return res;
  }

  private async runJob(jobId: string | undefined, data: MeasureJobData | undefined): Promise<unknown> {
    const fixId = data?.fixId;
    this.logger.log(`measure running jobId=${jobId} fixId=${fixId}`);
    return this.processMeasurementJob(fixId as string);
  }

  /**
   * Reconciliation sweep (Prompt 5): enqueue applied, outcome-less Fixes
   * whose window has elapsed — pre-Prompt-4 rows, jobs lost to restarts,
   * jobs exhausted after bounded retries. Covers all of those because the
   * database is authoritative (Part 11): anything still eligible is
   * re-derived, never trusted from Redis state.
   *
   * Bounded (Part 4): fixed-size batches cap memory; the per-run cap keeps
   * the post-downtime burst at the Prompt 4 total; positions are staggered
   * to avoid a thundering herd. `hasMore` + repeat-call safety (schedule
   * dedupe) is the continuation mechanism — no unbounded loading, no cron.
   * Runs at bootstrap; production may additionally trigger it from an
   * operator/cron hook later (no scheduler invented here).
   */
  async sweepEligible(limit = SWEEP_MAX_PER_RUN, trigger: SweepTrigger = "manual"): Promise<SweepResult> {
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SWEEP_MAX_PER_RUN;
    const now = new Date();
    const where = {
      status: "applied" as const,
      outcome: { is: null },
      expectedMeasurementDate: { lte: now },
    };
    let scanned = 0;
    let scheduled = 0;
    let skipped = 0;
    let batches = 0;
    let cursor: string | undefined;
    let hasMore = true;
    let position = 0;
    // Stable keyset pagination: (expectedMeasurementDate, id) never shifts
    // under concurrent inserts the way offsets do; repeats stay safe anyway
    // via schedule dedupe.
    while (hasMore && scanned < cap) {
      const pageSize = Math.min(SWEEP_BATCH_SIZE, cap - scanned);
      const rows = await this.prisma.fix.findMany({
        where,
        orderBy: [{ expectedMeasurementDate: "asc" }, { id: "asc" }],
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, expectedMeasurementDate: true },
      });
      batches += 1;
      scanned += rows.length;
      for (const row of rows) {
        try {
          const r = await this.scheduleMeasurement(row.id, position * SWEEP_STAGGER_MS, {
            expectedMeasurementDate: row.expectedMeasurementDate ?? undefined,
          });
          position += 1;
          if (r.deduplicated) skipped += 1;
          else scheduled += 1;
        } catch (e) {
          this.logger.warn(`measure sweep schedule failed fixId=${row.id}: ${e instanceof Error ? e.message : String(e)}`);
          skipped += 1;
        }
      }
      // A short page proves exhaustion; a full page means more may exist
      // (the loop cap decides whether this run continues).
      hasMore = rows.length === pageSize;
      cursor = rows.length > 0 ? rows[rows.length - 1]!.id : undefined;
    }
    const result: SweepResult = { scanned, eligible: scanned, scheduled, skipped, batches, hasMore };
    this.lastSweep = { ...result, at: new Date().toISOString(), trigger };
    this.logger.log(
      `measure sweep trigger=${trigger} scanned=${scanned} eligible=${scanned} scheduled=${scheduled} skipped=${skipped} batches=${batches} hasMore=${hasMore}`,
    );
    return result;
  }

  /**
   * Hourly recovery trigger (Prompt 6). The ONLY thing the scheduler does
   * is call the existing `sweepEligible()` — no separate scheduling logic,
   * no measurement logic here. Safe to invoke directly (tests do exactly
   * that; in test env the cron trigger itself is never registered).
   *
   * Never throws outward: sweep failures are logged and retried next hour;
   * no Fix is ever marked measured by this path.
   */
  @Cron(MEASURE_SWEEP_CRON_EXPRESSION, { name: MEASURE_SWEEP_CRON_NAME })
  async runMeasurementRecoverySweep(): Promise<
    (SweepResult & { trigger: SweepTrigger }) | { trigger: SweepTrigger; skipped: "overlap" } | { trigger: SweepTrigger; failed: true; error: string }
  > {
    const trigger: SweepTrigger = "scheduled";
    if (this.sweepRunning) {
      this.logger.log(`measure recovery sweep trigger=${trigger} skipped=overlap`);
      return { trigger, skipped: "overlap" as const };
    }
    this.sweepRunning = true;
    const startedAt = Date.now();
    try {
      const result = await this.sweepEligible(SWEEP_MAX_PER_RUN, trigger);
      this.logger.log(
        `measure recovery sweep trigger=${trigger} scanned=${result.scanned} eligible=${result.eligible} scheduled=${result.scheduled} skipped=${result.skipped} batches=${result.batches} hasMore=${result.hasMore} durationMs=${Date.now() - startedAt}`,
      );
      return { ...result, trigger };
    } catch (e) {
      // Scheduler-level failure (e.g. DB unreachable): log the category,
      // keep the process alive, retry next hour. No measurement state is
      // touched by this path (sweep per-fix scheduling already catches).
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`measure recovery sweep trigger=${trigger} failed=true error=${message} durationMs=${Date.now() - startedAt}`);
      return { trigger, failed: true as const, error: message };
    } finally {
      this.sweepRunning = false;
    }
  }
}
