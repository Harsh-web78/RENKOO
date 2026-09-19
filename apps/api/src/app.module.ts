import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { envValidationSchema } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { GoogleModule } from "./google/google.module";
import { IngestionModule } from "./ingestion/ingestion.module";
import { RecommendationModule } from "./recommendation/recommendation.module";
import { HistoryModule } from "./history/history.module";
import { SanitizeExceptionFilter } from "./common/filters/sanitize-exception.filter";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../.env", "../../.env"],
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      cache: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    // Prompt 6: hourly recovery-sweep trigger. Deliberately ABSENT in test
    // env — an hourly cron timer would hold the jest event loop open past
    // teardown. Without ScheduleModule the @Cron method is inert metadata
    // (still directly invocable by tests); in dev/prod the trigger is live.
    // Unset NODE_ENV fails open toward production behavior (enabled).
    ...(process.env.NODE_ENV === "test" ? [] : [ScheduleModule.forRoot()]),
    PrismaModule,
    HealthModule,
    AuthModule,
    WorkspacesModule,
    GoogleModule,
    IngestionModule,
    RecommendationModule,
    HistoryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // PROMPT 7 (P1): sanitize unexpected throws to generic 500s so Prisma
    // internals, driver messages and stacks never reach clients.
    {
      provide: APP_FILTER,
      useClass: SanitizeExceptionFilter,
    },
  ],
})
export class AppModule {}
