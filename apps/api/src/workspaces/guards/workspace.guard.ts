import { CanActivate, ExecutionContext, Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class WorkspaceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const session = (req as any).session as { userId?: string } | undefined;
    const userId = session?.userId;
    if (!userId) {
      // SessionAuthGuard should have already rejected, but double-check
      throw new ForbiddenException({ code: "AUTH_REQUIRED", message: "Sign in again." });
    }

    const workspaceId =
      (req.params as Record<string, string | undefined>).workspaceId ??
      (req.headers["x-workspace-id"] as string | undefined);

    if (!workspaceId) {
      throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "Missing workspace context." });
    }

    // Validate membership — never trust client-supplied id without DB check
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!membership) {
      // Use 403 for isolation (403 not 404 to avoid leaking existence? But 403 reveals existence vs 404 hides. Use 403 for workspace auth fail per §16)
      throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "You don't have access to this workspace." });
    }

    // Ensure workspace actually exists (membership implies, but double-check for NotFound alignment)
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException({ code: "PROPERTY_NOT_FOUND", message: "We couldn't find that workspace." });
    }

    // Attach workspaceId for downstream use
    (req as any).workspaceId = workspaceId;
    (req as any).workspaceRole = membership.role;

    return true;
  }
}
