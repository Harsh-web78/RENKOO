import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Queue, Worker, QueueEvents, JobsOptions } from "bullmq";
import IORedis from "ioredis";

export interface IngestJobData {
  workspaceId: string;
  propertyId: string;
  userId: string;
}

@Injectable()
export class IngestionQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionQueue.name);
  private queue: Queue<IngestJobData> | null = null;
  private queueEvents: QueueEvents | null = null;
  private worker: Worker<IngestJobData> | null = null;
  private redis: IORedis | null = null;
  private isReady = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.config.get<string>("REDIS_URL", "");
    const nodeEnv = this.config.get<string>("NODE_ENV", "development");
    if (nodeEnv === "test") {
      this.logger.log("IngestionQueue disabled in test env — using direct execution");
      return;
    }
    if (!redisUrl) {
      this.logger.warn("REDIS_URL not set — ingestion queue disabled");
      return;
    }
    try {
      this.redis = new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
      this.redis.on("error", (err) => this.logger.warn(`IngestionQueue Redis error: ${err}`));
      await this.redis.ping().catch(() => {
        this.logger.warn("IngestionQueue Redis ping failed — queue disabled");
        this.redis = null;
      });
      if (!this.redis) return;

      this.queue = new Queue<IngestJobData>("ingestion", { connection: this.redis });
      this.queueEvents = new QueueEvents("ingestion", { connection: this.redis.duplicate() });
      this.isReady = true;
      this.logger.log("IngestionQueue ready");
    } catch (e) {
      this.logger.warn(`IngestionQueue init failed: ${e}`);
      this.queue = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => {});
    await this.queueEvents?.close().catch(() => {});
    await this.worker?.close().catch(() => {});
    await this.redis?.quit().catch(() => {});
  }

  isQueueReady(): boolean {
    return this.isReady && !!this.queue;
  }

  async addJob(data: IngestJobData): Promise<{ jobId: string; queued: boolean }> {
    if (!this.queue) {
      // Fallback: no queue, caller should execute directly
      return { jobId: `direct-${Date.now()}`, queued: false };
    }

    const opts: JobsOptions = {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
      // BullMQ rejects custom jobIds containing ":" (installed job.js throws
      // "Custom Id cannot contain :" unless the id splits into exactly 3
      // segments). Dashes keep uniqueness without behavior change.
      jobId: `ingest-${data.workspaceId}-${data.propertyId}-${Date.now()}`, // allow multiple
    };

    // Only retry on transient errors; BullMQ will retry on all failures, but provider already maps permanent 403 to not retry
    // We handle permanent vs transient in processor by checking error code
    const job = await this.queue.add("ingest", data, opts);
    this.logger.log(`Enqueued ingestion job ${job.id} for property ${data.propertyId}`);
    return { jobId: job.id ?? "unknown", queued: true };
  }

  getQueue(): Queue<IngestJobData> | null {
    return this.queue;
  }

  // For testing: allow direct access to check rate limiting
  async checkGscRateLimit(siteUrl: string): Promise<void> {
    if (!this.redis) return;
    const key = `gsc:qpm:${siteUrl}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, 60);
    }
    if (count > 1200) {
      throw { code: "RATE_LIMITED", message: "RENKO hit a Search Console rate limit. Try again shortly." };
    }
  }
}
