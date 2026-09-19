import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { RecommendationModule } from "../recommendation/recommendation.module";

@Module({
  // RecommendationModule only (acyclic: it imports no feature modules) —
  // exposes MeasurementQueue for the lightweight readiness signal.
  imports: [RecommendationModule],
  controllers: [HealthController],
})
export class HealthModule {}
