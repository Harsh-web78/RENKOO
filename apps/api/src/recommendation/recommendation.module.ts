import { Module } from "@nestjs/common";
import { RecommendationController } from "./recommendation.controller";
import { RecommendationService } from "./recommendation.service";
import { MeasurementQueue } from "./measurement.queue";

@Module({
  controllers: [RecommendationController],
  providers: [RecommendationService, MeasurementQueue],
  exports: [RecommendationService, MeasurementQueue],
})
export class RecommendationModule {}
