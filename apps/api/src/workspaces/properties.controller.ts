import { Controller, Get, Param, Post, UseGuards, Req, HttpException, HttpStatus } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { WorkspaceAuthGuard } from "./guards/workspace.guard";
import { CsrfGuard } from "../common/guards/csrf.guard";
import { SearchConsoleService } from "../search-console/search-console.service";

@Controller("workspaces/:workspaceId/properties")
export class PropertiesController {
  constructor(private readonly searchConsole: SearchConsoleService) {}

  private mapDataErrorToHttp(error: { code: string; message: string }): never {
    switch (error.code) {
      case "AUTH_REQUIRED":
        throw new HttpException({ code: error.code, message: error.message }, HttpStatus.UNAUTHORIZED);
      case "PERMISSION_DENIED":
        throw new HttpException({ code: error.code, message: error.message }, HttpStatus.FORBIDDEN);
      case "PROPERTY_NOT_FOUND":
        throw new HttpException({ code: error.code, message: error.message }, HttpStatus.NOT_FOUND);
      case "RATE_LIMITED":
        throw new HttpException({ code: error.code, message: error.message }, HttpStatus.TOO_MANY_REQUESTS);
      case "UPSTREAM_ERROR":
        throw new HttpException({ code: error.code, message: error.message }, HttpStatus.BAD_GATEWAY);
      default:
        throw new HttpException({ code: error.code, message: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get()
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async list(@Param("workspaceId") workspaceId: string) {
    const properties = await this.searchConsole.listPropertiesFromDb(workspaceId);
    return { properties };
  }

  @Post("sync")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard, CsrfGuard)
  @Throttle({ default: { ttl: 300000, limit: 1 } })
  async sync(@Param("workspaceId") workspaceId: string, @Req() req: Request) {
    const userId = (req.session as unknown as { userId: string }).userId;
    try {
      const result = await this.searchConsole.syncProperties({ workspaceId, userId });
      return { synced: result.synced, properties: await this.searchConsole.listPropertiesFromDb(workspaceId) };
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        this.mapDataErrorToHttp(e as { code: string; message: string });
      }
      throw e;
    }
  }
}
