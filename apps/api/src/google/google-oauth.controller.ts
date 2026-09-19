import { Controller, Get, Post, Query, Req, Res, UseGuards, Body, HttpCode } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Request, Response } from "express";
import * as crypto from "crypto";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { CsrfGuard } from "../common/guards/csrf.guard";
import { GoogleOAuthService } from "./google-oauth.service";
import { PrismaService } from "../prisma/prisma.service";

@Controller("auth/google")
export class GoogleOAuthController {
  constructor(
    private readonly google: GoogleOAuthService,
    private readonly prisma: PrismaService,
  ) {}

  private getWorkspaceIdFromSession(req: Request): string | undefined {
    const session = req.session as unknown as { oauthWorkspaceId?: string; userId?: string } | undefined;
    return session?.oauthWorkspaceId;
  }

  private async resolveWorkspaceId(req: Request, queryWorkspaceId?: string): Promise<string> {
    // If client supplies workspaceId, validate membership and use it
    if (queryWorkspaceId) {
      const userId = (req.session as unknown as { userId: string }).userId;
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: queryWorkspaceId } },
      });
      if (!membership) {
        throw new Error("WORKSPACE_FORBIDDEN");
      }
      return queryWorkspaceId;
    }

    // Derive from session's first workspace (prompt 7's listForUser)
    const userId = (req.session as unknown as { userId: string }).userId;
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) {
      throw new Error("NO_WORKSPACE");
    }
    return membership.workspaceId;
  }

  private timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  @Get("start")
  @UseGuards(SessionAuthGuard)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async start(
    @Req() req: Request,
    @Res() res: Response,
    @Query("workspaceId") workspaceId?: string,
  ): Promise<void> {
    // Validate workspace exists and user is member (if supplied)
    let targetWorkspaceId: string;
    try {
      targetWorkspaceId = await this.resolveWorkspaceId(req, workspaceId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "WORKSPACE_FORBIDDEN") {
        res.status(403).json({ code: "PERMISSION_DENIED", message: "You don't have access to this workspace." });
        return;
      }
      if (msg === "NO_WORKSPACE") {
        res.status(400).json({ code: "NO_WORKSPACE", message: "No workspace found for user." });
        return;
      }
      throw e;
    }

    const state = crypto.randomBytes(32).toString("base64url");
    const isProd = process.env.NODE_ENV === "production";

    // Store server-side: session + remember workspace for callback
    (req.session as unknown as Record<string, unknown>).oauthState = state;
    (req.session as unknown as Record<string, unknown>).oauthStateExpiresAt = Date.now() + 600_000;
    (req.session as unknown as Record<string, unknown>).oauthWorkspaceId = targetWorkspaceId;

    // Production-hardening: persist the session BEFORE redirecting to
    // Google. express-session otherwise saves implicitly at end-of-response;
    // with a Redis store that write can fail (or lose a startup/connect race)
    // after the 302 is already out, and the callback then finds an empty
    // session → 403 "Missing OAuth state.". Fail closed here instead of
    // sending the user to Google with doomed state.
    try {
      const save = req.session?.save;
      if (typeof save !== "function") throw new Error("SESSION_UNAVAILABLE");
      await new Promise<void>((resolve, reject) => {
        save.call(req.session, (err: unknown) => {
          if (err) reject(err instanceof Error ? err : new Error(String(err)));
          else resolve();
        });
      });
    } catch {
      res.status(503).json({
        code: "OAUTH_SESSION_UNAVAILABLE",
        message: "Could not start the Google connection. Please try again.",
      });
      return;
    }

    // httpOnly cookie per architecture §5.5
    res.cookie("oauth_state", state, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/api/v1/auth/google",
      maxAge: 600_000,
    });

    let authUrl: string;
    try {
      authUrl = this.google.buildAuthorizationUrl(state);
    } catch {
      res.status(500).json({ code: "OAUTH_NOT_CONFIGURED", message: "Google OAuth not configured." });
      return;
    }

    res.redirect(302, authUrl);
  }

  @Get("callback")
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ): Promise<void> {
    const frontendUrl = this.google.getFrontendUrl();

    // Handle OAuth error (user denied, etc.)
    if (error) {
      this.clearOAuthState(req, res);
      res.redirect(302, `${frontendUrl}/onboarding/connect-search-console?status=error&error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      this.clearOAuthState(req, res);
      res.redirect(302, `${frontendUrl}/onboarding/connect-search-console?status=error&error=missing_params`);
      return;
    }

    const sessionState = (req.session as unknown as { oauthState?: string; oauthStateExpiresAt?: number })?.oauthState;
    const expiresAt = (req.session as unknown as { oauthStateExpiresAt?: number })?.oauthStateExpiresAt;
    const cookieState = (req.cookies as Record<string, string | undefined>)?.oauth_state;

    // Validate state: must match both session and cookie via constant-time, and not expired
    if (!sessionState || !cookieState || !state) {
      this.clearOAuthState(req, res);
      res.status(403).json({ code: "FORBIDDEN", message: "Missing OAuth state." });
      return;
    }

    if (expiresAt && Date.now() > expiresAt) {
      this.clearOAuthState(req, res);
      res.status(403).json({ code: "FORBIDDEN", message: "OAuth state expired." });
      return;
    }

    const validSession = this.timingSafeEqual(state, sessionState);
    const validCookie = this.timingSafeEqual(state, cookieState);
    if (!validSession || !validCookie) {
      this.clearOAuthState(req, res);
      res.status(403).json({ code: "FORBIDDEN", message: "Invalid OAuth state." });
      return;
    }

    // Need authenticated session to tie to workspace/user
    const userId = (req.session as unknown as { userId?: string })?.userId;
    if (!userId) {
      this.clearOAuthState(req, res);
      res.status(401).json({ code: "AUTH_REQUIRED", message: "Sign in again." });
      return;
    }

    const workspaceId = this.getWorkspaceIdFromSession(req);
    if (!workspaceId) {
      this.clearOAuthState(req, res);
      res.status(400).json({ code: "NO_WORKSPACE", message: "No workspace in OAuth state." });
      return;
    }

    // Clear state before token exchange to prevent replay
    this.clearOAuthState(req, res);

    // Exchange code for tokens (server-to-server)
    let tokens: { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string };
    try {
      tokens = await this.google.exchangeCodeForTokens(code);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Do not leak client secret; redirect with error
      res.redirect(
        302,
        `${frontendUrl}/onboarding/connect-search-console?status=error&error=${encodeURIComponent(msg.slice(0, 200))}`,
      );
      return;
    }

    let googleEmail: string | undefined;
    try {
      googleEmail = await this.google.fetchGoogleEmail(tokens.access_token, tokens.id_token);
    } catch {
      // non-fatal, keep undefined
    }

    try {
      await this.google.upsertConnection({
        workspaceId,
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in ?? 3600,
        scopes: tokens.scope,
        googleEmail,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.redirect(302, `${frontendUrl}/onboarding/connect-search-console?status=error&error=${encodeURIComponent(msg.slice(0, 200))}`);
      return;
    }

    // Success: clear oauth cookie already, redirect to frontend success
    // Also set Secure cookie clearing already done
    res.redirect(302, `${frontendUrl}/onboarding/connect-search-console?status=connected`);
  }

  @Post("revoke")
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @HttpCode(200)
  async revoke(
    @Req() req: Request,
    @Body() body: { workspaceId?: string },
  ): Promise<{ ok: true }> {
    const userId = (req.session as unknown as { userId: string }).userId;
    let workspaceId = body?.workspaceId as string | undefined;

    if (!workspaceId) {
      const membership = await this.prisma.workspaceMember.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
      });
      if (!membership) {
        return { ok: true };
      }
      workspaceId = membership.workspaceId;
    } else {
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
      });
      if (!membership) {
        const { ForbiddenException } = await import("@nestjs/common");
        throw new ForbiddenException({ code: "PERMISSION_DENIED", message: "You don't have access to this workspace." });
      }
    }

    await this.google.revokeConnection(workspaceId);
    return { ok: true };
  }

  private clearOAuthState(req: Request, res: Response): void {
    try {
      (req.session as unknown as Record<string, unknown>).oauthState = undefined;
      (req.session as unknown as Record<string, unknown>).oauthStateExpiresAt = undefined;
      (req.session as unknown as Record<string, unknown>).oauthWorkspaceId = undefined;
    } catch {}
    const isProd = process.env.NODE_ENV === "production";
    res.clearCookie("oauth_state", {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/api/v1/auth/google",
    });
  }
}
