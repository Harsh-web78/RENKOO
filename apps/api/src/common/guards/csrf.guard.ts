import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from "@nestjs/common";
import { Request } from "express";

/**
 * CSRF double-submit guard.
 *
 * Expects token in header `x-csrf-token` or `x-xsrf-token` (case-insensitive via Express).
 * Compares against `req.session.csrfToken`.
 *
 * GET /auth/csrf, POST sign-up/login, and health endpoints are exempt.
 * This guard should be applied only to state-changing authenticated routes
 * (logout, workspace mutations). Tests cover valid/missing/invalid token.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const session = (req as unknown as { session?: { csrfToken?: string } }).session;
    if (!session) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Missing session for CSRF check." });
    }

    const headerToken =
      (req.headers["x-csrf-token"] as string | undefined) ??
      (req.headers["x-xsrf-token"] as string | undefined) ??
      (req.headers["x-csrf-token".toLowerCase()] as string | undefined);

    if (!headerToken || !session.csrfToken) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Missing CSRF token." });
    }

    // Constant-time comparison would be ideal; for scaffold we use direct compare.
    if (headerToken !== session.csrfToken) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Invalid CSRF token." });
    }

    return true;
  }
}
