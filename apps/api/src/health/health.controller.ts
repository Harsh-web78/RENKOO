import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type ComponentStatus = "ok" | "down" | "unknown";

interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  db: ComponentStatus;
  redis: ComponentStatus;
  uptimeSeconds: number;
}

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
