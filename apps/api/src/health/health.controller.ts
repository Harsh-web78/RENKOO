import { Controller, Get, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MeasurementQueue } from "../recommendation/measurement.queue";
import type { QueueHealth } from "../recommendation/measurement.queue";

type ComponentStatus = "ok" | "down" | "unknown";

interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  db: ComponentStatus;
  redis: ComponentStatus;
  uptimeSeconds: number;
  /**
   * Prompt 5: lightweight measurement-queue visibility (provider-known
   * state only — no Fix queries, no Redis ping, no secrets). Absent when
   * the queue provider is not wired (never breaks liveness/readiness).
   */
  measurementQueue?: QueueHealth | { status: "unknown"; worker: "unknown"; lastSweep: null };
}

@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    // Class token resolves when RecommendationModule is imported (see
    // HealthModule); @Optional keeps health alive if wiring ever changes.
    @Optional() private readonly measurements?: MeasurementQueue,
  ) {}

  @Get()
  liveness(): HealthResponse {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      db: "unknown",
      redis: "unknown",
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  @Get("ready")
  async readiness(): Promise<HealthResponse> {
    const db = await this.checkDb();
    // Redis is optional for core request paths (sessions degrade to
    // MemoryStore, ingestion executes directly); no Redis gate here.
    const redis: ComponentStatus = "unknown";
    const status: HealthResponse["status"] = db === "ok" ? "ok" : "degraded";
    return {
      status,
      timestamp: new Date().toISOString(),
      db,
      redis,
      uptimeSeconds: Math.round(process.uptime()),
      measurementQueue: this.measurements?.getQueueHealth() ?? { status: "unknown", worker: "unknown", lastSweep: null },
    };
  }

  private async checkDb(): Promise<ComponentStatus> {
    try {
      // Lightweight query — succeeds if DATABASE_URL is reachable.
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "down";
    }
  }
}
