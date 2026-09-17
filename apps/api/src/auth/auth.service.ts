import { ConflictException, Injectable, UnauthorizedException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import * as bcrypt from "bcrypt";

const BCRYPT_SALT_ROUNDS = 10;

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  plan: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private sanitizeUser(user: { id: string; email: string }): AuthUser {
    return { id: user.id, email: user.email };
  }

  async signUp(params: { email: string; password: string; workspaceName?: string }): Promise<{
    user: AuthUser;
    workspace: AuthWorkspace;
  }> {
    const email = this.normalizeEmail(params.email);
    const password = params.password;
    const workspaceName = params.workspaceName?.trim() || this.deriveWorkspaceName(email);

    // Check duplicate before hashing for fast path (also handled by unique constraint)
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException({ code: "EMAIL_EXISTS", message: "This email is already registered. Log in instead." });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash },
        });
        const workspace = await tx.workspace.create({
          data: { name: workspaceName },
        });
        await tx.workspaceMember.create({
          data: { userId: user.id, workspaceId: workspace.id, role: "owner" },
        });
        return { user, workspace };
      });

      this.logger.log(`User signed up ${email} workspace ${result.workspace.id}`);
      return {
        user: this.sanitizeUser(result.user),
        workspace: { id: result.workspace.id, name: result.workspace.name, plan: result.workspace.plan },
      };
    } catch (err: unknown) {
      // Handle race-condition duplicate (P2002)
      if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
        throw new ConflictException({ code: "EMAIL_EXISTS", message: "This email is already registered. Log in instead." });
      }
      throw err;
    }
  }

  async logIn(params: { email: string; password: string }): Promise<{ user: AuthUser; workspaces: AuthWorkspace[] }> {
    const email = this.normalizeEmail(params.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Those credentials don't match our records." });
    }
    const match = await bcrypt.compare(params.password, user.passwordHash);
    if (!match) {
      throw new UnauthorizedException({ code: "INVALID_CREDENTIALS", message: "Those credentials don't match our records." });
    }

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: true },
    });
    const workspaces: AuthWorkspace[] = memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      plan: m.workspace.plan,
    }));

    this.logger.log(`User logged in ${email}`);
    return { user: this.sanitizeUser(user), workspaces };
  }

  async getMe(userId: string): Promise<{ user: AuthUser; workspaces: AuthWorkspace[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "Sign in again." });
    }
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId: user.id },
      include: { workspace: true },
    });
    const workspaces = memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      plan: m.workspace.plan,
    }));
    return { user: this.sanitizeUser(user), workspaces };
  }

  private deriveWorkspaceName(email: string): string {
    const prefix = email.split("@")[0] ?? "workspace";
    // Simple title case of prefix, fallback to "My Workspace"
    const base = prefix.replace(/[^a-zA-Z0-9]+/g, " ").trim();
    if (!base) return "My Workspace";
    return base.charAt(0).toUpperCase() + base.slice(1) + "'s Workspace";
  }
}
