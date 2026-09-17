import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface WorkspaceDto {
  id: string;
  name: string;
  plan: string;
  role: string;
}

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<WorkspaceDto[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: "asc" },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      plan: m.workspace.plan,
      role: m.role,
    }));
  }

  async getForUser(userId: string, workspaceId: string): Promise<WorkspaceDto> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      include: { workspace: true },
    });
    if (!membership) {
      throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "You don't have access to this workspace." });
    }
    return {
      id: membership.workspace.id,
      name: membership.workspace.name,
      plan: membership.workspace.plan,
      role: membership.role,
    };
  }

  async createForUser(userId: string, name: string): Promise<WorkspaceDto> {
    const workspace = await this.prisma.workspace.create({ data: { name } });
    const membership = await this.prisma.workspaceMember.create({
      data: { userId, workspaceId: workspace.id, role: "owner" },
      include: { workspace: true },
    });
    return {
      id: membership.workspace.id,
      name: membership.workspace.name,
      plan: membership.workspace.plan,
      role: membership.role,
    };
  }
}
