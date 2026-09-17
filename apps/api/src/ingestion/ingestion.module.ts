import { Module } from "@nestjs/common";
import { SearchConsoleModule } from "../search-console/search-console.module";
import { IngestionService } from "./ingestion.service";
import { IngestionController } from "./ingestion.controller";
import { IngestionQueue } from "./ingestion.queue";

@Module({
  imports: [SearchConsoleModule],
  controllers: [IngestionController],
  providers: [IngestionService, IngestionQueue],
  exports: [IngestionService],
})
export class IngestionModule {}
