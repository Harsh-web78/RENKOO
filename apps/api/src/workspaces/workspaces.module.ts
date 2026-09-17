import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { PropertiesController } from "./properties.controller";
import { WorkspacesService } from "./workspaces.service";
import { SearchConsoleModule } from "../search-console/search-console.module";

@Module({
  imports: [SearchConsoleModule],
  controllers: [WorkspacesController, PropertiesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
