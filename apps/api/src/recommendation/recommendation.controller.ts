import { Body, Controller, Get, Param, Post, UseGuards, HttpException, HttpStatus } from "@nestjs/common";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { WorkspaceAuthGuard } from "../workspaces/guards/workspace.guard";
import { CsrfGuard } from "../common/guards/csrf.guard";
import { RecommendationService } from "./recommendation.service";
import { PrismaService } from "../prisma/prisma.service";

@Controller("workspaces/:workspaceId/properties/:propertyId")
export class RecommendationController {
  constructor(
    private readonly recService: RecommendationService,
    private readonly prisma: PrismaService,
  ) {}

  private async ensureProperty(workspaceId: string, propertyId: string) {
    const prop = await this.prisma.searchProperty.findFirst({ where: { id: propertyId, workspaceId } });
    if (!prop) {
      throw new HttpException({ code: "PROPERTY_NOT_FOUND", message: "We couldn't find that property in this workspace." }, HttpStatus.NOT_FOUND);
    }
    return prop;
  }

  @Get("recommendation")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async getRecommendation(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    const result = await this.recService.getRecommendation({ workspaceId, propertyId });
    // Map to frontend RecommendationResult shape
    // Do not expose internal snapshot id, just return as is
    return result;
  }

  @Get("fix")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async getFix(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    const fix = await this.recService.getFix({ workspaceId, propertyId });
    return { fix };
  }

  @Post("fix/:fixId/review")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard, CsrfGuard)
  async review(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fixId") fixId: string,
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    const fix = await this.recService.reviewFix({ workspaceId, propertyId, fixId });
    return { fix };
  }

  @Post("fix/:fixId/apply")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard, CsrfGuard)
  async apply(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fixId") fixId: string,
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    const fix = await this.recService.applyFix({ workspaceId, propertyId, fixId });
    return { fix };
  }

  @Post("fix/:fixId/dismiss")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard, CsrfGuard)
  async dismiss(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fixId") fixId: string,
    @Body() body: { reason?: string },
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    const fix = await this.recService.dismissFix({ workspaceId, propertyId, fixId, reason: body?.reason });
    return { fix };
  }

  @Post("fix/:fixId/acknowledge")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard, CsrfGuard)
  async acknowledge(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fixId") fixId: string,
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    await this.recService.acknowledgeFix({ workspaceId, propertyId, fixId });
    return { ok: true };
  }

  @Post("fix/:fixId/check")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard, CsrfGuard)
  async check(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fixId") fixId: string,
  ) {
    await this.ensureProperty(workspaceId, propertyId);
    const result = await this.recService.checkFix({ workspaceId, propertyId, fixId });
    return result;
  }
}
