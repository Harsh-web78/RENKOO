import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

export interface SessionUser {
  id: string;
  email: string;
}

declare module "express-session" {
  interface SessionData {
    userId?: string;
    userEmail?: string;
    csrfToken?: string;
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { session?: Record<string, unknown> }>();
    const session = (req as unknown as { session?: Record<string, unknown> }).session as
      | { userId?: string; userEmail?: string }
      | undefined;
    if (!session?.userId) {
      throw new UnauthorizedException({ code: "AUTH_REQUIRED", message: "Sign in again." });
    }
    // Attach user for downstream handlers
    (req as unknown as { user: SessionUser }).user = {
      id: session.userId,
      email: session.userEmail ?? "",
    };
    return true;
  }
}
