import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log("Prisma connected");
    } catch (err) {
      // During scaffold (no real DATABASE_URL / no DB running), connection will fail.
      // We log a warning but do not crash process so `nest build` / health checks
      // can still start without a live DB. Runtime callers that need DB will fail
      // explicitly; HealthModule reports db=down instead.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Prisma connect skipped (expected without DB running): ${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
