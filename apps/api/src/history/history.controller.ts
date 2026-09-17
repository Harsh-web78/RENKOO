import { Controller, Get, HttpException, HttpStatus, Param, Query, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsInt, IsOptional, Min } from "class-validator";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { WorkspaceAuthGuard } from "../workspaces/guards/workspace.guard";
import { HistoryService } from "./history.service";

class ListHistoryQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

@Controller("workspaces/:workspaceId/history")
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get()
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async list(@Param("workspaceId") workspaceId: string, @Query() query: ListHistoryQuery) {
    // ValidationPipe (global, with implicit conversion) rejects out-of-range
    // values with 400; the service additionally clamps defensively.
    return this.history.listHistory({
      workspaceId,
      limit: query.limit,
      offset: query.offset,
    });
  }

  @Get(":fixId")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async detail(@Param("workspaceId") workspaceId: string, @Param("fixId") fixId: string) {
    const item = await this.history.getHistoryDetail({ workspaceId, fixId });
    if (!item) {
      // Another workspace's Fix, an unknown id, or a non-history (current)
      // fix all surface as 404 — never leak existence or contents.
      throw new HttpException(
        { code: "PROPERTY_NOT_FOUND", message: "We couldn't find that history item in this workspace." },
        HttpStatus.NOT_FOUND,
      );
    }
    return { item };
  }
}
