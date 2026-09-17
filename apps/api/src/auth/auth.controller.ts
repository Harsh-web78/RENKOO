import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import * as crypto from "crypto";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { SignUpDto } from "./dto/sign-up.dto";
import { LogInDto } from "./dto/log-in.dto";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { CsrfGuard } from "../common/guards/csrf.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @Post("sign-up")
  @HttpCode(201)
  async signUp(@Body() dto: SignUpDto, @Req() req: Request): Promise<{ user: { id: string; email: string }; workspace: { id: string; name: string; plan: string } }> {
    const result = await this.auth.signUp({ email: dto.email, password: dto.password, workspaceName: dto.workspaceName });
    // Regenerate session to prevent fixation
    await this.regenerateSession(req);
    (req.session as any).userId = result.user.id;
    (req.session as any).userEmail = result.user.email;
    // Create CSRF token at sign-up so subsequent POSTs have valid token without extra round-trip
    (req.session as any).csrfToken = crypto.randomBytes(32).toString("hex");
    return result;
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("log-in")
  @HttpCode(200)
  async logIn(@Body() dto: LogInDto, @Req() req: Request): Promise<{ user: { id: string; email: string }; workspaces: { id: string; name: string; plan: string }[] }> {
    const result = await this.auth.logIn({ email: dto.email, password: dto.password });
    await this.regenerateSession(req);
    (req.session as any).userId = result.user.id;
    (req.session as any).userEmail = result.user.email;
    (req.session as any).csrfToken = crypto.randomBytes(32).toString("hex");
    return result;
  }

  @Post("log-out")
  @UseGuards(SessionAuthGuard, CsrfGuard)
  @HttpCode(200)
  async logOut(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    await this.destroySession(req, res);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  async me(@Req() req: Request): Promise<{ user: { id: string; email: string }; workspaces: { id: string; name: string; plan: string }[] }> {
    const userId = (req.session as any).userId as string;
    return this.auth.getMe(userId);
  }

  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @Get("csrf")
  async csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ csrfToken: string }> {
    // If no session yet (anonymous), create one lazily so token is bound
    if (!(req.session as any).csrfToken) {
      (req.session as any).csrfToken = crypto.randomBytes(32).toString("hex");
    }
    const token = (req.session as any).csrfToken as string;
    const isProd = process.env.NODE_ENV === "production";
    // Double-submit cookie (non-httpOnly) — frontend reads and sends as header
    res.cookie("XSRF-TOKEN", token, {
      httpOnly: false,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return { csrfToken: token };
  }

  private regenerateSession(req: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private destroySession(req: Request, res: Response): Promise<void> {
    return new Promise((resolve, reject) => {
      req.session.destroy((err) => {
        if (err) {
          reject(err);
          return;
        }
        // Clear cookie on client
        res.clearCookie("renko.sid", { path: "/" });
        res.clearCookie("XSRF-TOKEN", { path: "/" });
        resolve();
      });
    });
  }
}
