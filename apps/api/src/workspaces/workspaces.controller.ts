import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request } from "express";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { CsrfGuard } from "../common/guards/csrf.guard";
import { WorkspaceAuthGuard } from "./guards/workspace.guard";
import { WorkspacesService } from "./workspaces.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @UseGuards(SessionAuthGuard)
  async list(@Req() req: Request) {
    const userId = (req.session as any).userId as string;
    const list = await this.workspaces.listForUser(userId);
    return { workspaces: list };
  }

  @Get(":workspaceId")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async getOne(@Param("workspaceId") workspaceId: string, @Req() req: Request) {
    const userId = (req.session as any).userId as string;
    const ws = await this.workspaces.getForUser(userId, workspaceId);
    return { workspace: ws };
  }

  @Post()
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @HttpCode(201)
  async create(@Body() dto: CreateWorkspaceDto, @Req() req: Request) {
    const userId = (req.session as any).userId as string;
    const ws = await this.workspaces.createForUser(userId, dto.name);
    return { workspace: ws };
  }
}
