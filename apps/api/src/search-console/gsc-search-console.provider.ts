import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { TokenEncryptionService } from "../google/token-encryption.service";
import {
  SearchConsoleProvider,
  Result,
  ok,
  err,
  dataError,
  GscSiteEntry,
  DataError,
  GscAnalyticsResponse,
  GscQueryParams,
} from "./search-console.provider";
import { z } from "zod";
import Redis from "ioredis";

@Injectable()
export class GscSearchConsoleProvider implements SearchConsoleProvider {
  private readonly logger = new Logger(GscSearchConsoleProvider.name);
  private redis: Redis | null = null;
  private redisReady = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: TokenEncryptionService,
  ) {
    // Lazy Redis for per-site QPM bucket
    const redisUrl = this.config.get<string>("REDIS_URL", "");
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: false });
        this.redis.connect().catch(() => {
          this.redisReady = false;
        });
        this.redis.on("ready", () => (this.redisReady = true));
        this.redis.on("error", () => (this.redisReady = false));
      } catch {
        this.redis = null;
      }
    }
  }

  private getSitesListEndpoint(): string {
    // Use searchconsole.googleapis.com alias; webmasters/v3/sites is canonical
    return this.config.get<string>("GSC_SITES_ENDPOINT", "https://www.googleapis.com/webmasters/v3/sites");
  }

  private async getValidAccessToken(workspaceId: string): Promise<string> {
    const conn = await this.prisma.searchConsoleConnection.findUnique({ where: { workspaceId } });
    if (!conn) {
      throw dataError("AUTH_REQUIRED", "Google Search Console not connected for this workspace.");
    }
    if (conn.status !== "connected") {
      throw dataError("AUTH_REQUIRED", "Google Search Console connection expired. Reconnect.");
    }

    // Check expiry: refresh if <60s remaining
    const now = Date.now();
    const expiresAt = conn.accessTokenExpiresAt.getTime();
    if (expiresAt - now > 60_000) {
      // Token still valid
      return this.encryption.decrypt(conn.encryptedAccessToken);
    }

    // Need refresh
    const refreshToken = this.encryption.decrypt(conn.encryptedRefreshToken);
    if (!refreshToken || refreshToken === "__missing_refresh_token__") {
      throw dataError("AUTH_REQUIRED", "Google Search Console connection expired. Reconnect.");
    }

    const clientId = this.config.get<string>("GOOGLE_CLIENT_ID", "");
    const clientSecret = this.config.get<string>("GOOGLE_CLIENT_SECRET", "");
    const tokenEndpoint = this.config.get<string>("GOOGLE_TOKEN_ENDPOINT", "https://oauth2.googleapis.com/token");

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errCode = (json.error as string) ?? "token_refresh_failed";
      if (errCode === "invalid_grant") {
        // Mark expired
        await this.prisma.searchConsoleConnection.update({
          where: { workspaceId },
          data: { status: "expired" },
        });
        throw dataError("AUTH_REQUIRED", "Google Search Console connection expired. Reconnect.");
      }
      throw dataError("UPSTREAM_ERROR", `Token refresh failed: ${errCode}`);
    }

    const newAccess = json.access_token as string | undefined;
    const expiresIn = (json.expires_in as number | undefined) ?? 3600;
    if (!newAccess) {
      throw dataError("UPSTREAM_ERROR", "Token refresh missing access_token");
    }

    const encryptedAccess = this.encryption.encrypt(newAccess);
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000);
    await this.prisma.searchConsoleConnection.update({
      where: { workspaceId },
      data: {
        encryptedAccessToken: encryptedAccess,
        accessTokenExpiresAt: newExpiresAt,
        lastRefreshedAt: new Date(),
        status: "connected",
      },
    });

    this.logger.log(`Refreshed access token for workspace ${workspaceId}`);
    return newAccess;
  }

  private validateSiteUrl(url: string): void {
    if (!url) throw dataError("PROPERTY_NOT_FOUND", "Invalid site URL");
    const isDomain = url.startsWith("sc-domain:");
    const isUrlPrefix = /^https?:\/\/.+\/$/.test(url);
    if (!isDomain && !isUrlPrefix) {
      // According spec, URL-prefix must end with /
      throw dataError("PROPERTY_NOT_FOUND", `Invalid siteUrl format: ${url}`);
    }
  }

  private mapGscError(status: number, body: Record<string, unknown>): DataError {
    const errorObj = (body.error as Record<string, unknown> | undefined) ?? body;
    const reason = (errorObj as { errors?: { reason?: string }[] })?.errors?.[0]?.reason ?? (errorObj.reason as string | undefined);
    const message = (errorObj.message as string | undefined) ?? (body.error_description as string | undefined) ?? `GSC error ${status}`;

    if (status === 401) {
      return dataError("AUTH_REQUIRED", "Google Search Console session expired. Reconnect.");
    }
    if (status === 403) {
      // 403 can be quota or permission; check reason
      if (reason === "quotaExceeded" || message.toLowerCase().includes("quota")) {
        return dataError("RATE_LIMITED", "RENKO hit a Search Console rate limit. Try again shortly.");
      }
      return dataError("PERMISSION_DENIED", "RENKO doesn't have access to this property. Reconnect Search Console.");
    }
    if (status === 404) {
      return dataError("PROPERTY_NOT_FOUND", "We couldn't find that property.");
    }
    if (status === 429) {
      return dataError("RATE_LIMITED", "RENKO hit a Search Console rate limit. Try again shortly.");
    }
    if (status >= 500) {
      return dataError("UPSTREAM_ERROR", "RENKO couldn't reach Search Console right now.");
    }
    return dataError("UNKNOWN_ERROR", message);
  }

  async listProperties(params: { workspaceId: string; userId: string }): Promise<Result<GscSiteEntry[], DataError>> {
    const { workspaceId } = params;

    this.validateSiteUrlForList(); // dummy check

    let accessToken: string;
    try {
      accessToken = await this.getValidAccessToken(workspaceId);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        return err(e as DataError);
      }
      throw e;
    }

    const endpoint = this.getSitesListEndpoint();
    const url = endpoint; // GET https://www.googleapis.com/webmasters/v3/sites

    // Retry 3x on 429/500/503 with exponential backoff + jitter
    let lastError: DataError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.status === 429 || res.status === 500 || res.status === 503) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          lastError = this.mapGscError(res.status, body);
          if (attempt < 2) {
            const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return err(lastError);
        }

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          return err(this.mapGscError(res.status, body));
        }

        const json = (await res.json()) as { siteEntry?: { siteUrl: string; permissionLevel: string }[] };
        const entries: GscSiteEntry[] = (json.siteEntry ?? []).map((e) => ({
          siteUrl: e.siteUrl,
          permissionLevel: e.permissionLevel as GscSiteEntry["permissionLevel"],
        }));

        // Validate each siteUrl
        for (const e of entries) {
          try {
            this.validateSiteUrl(e.siteUrl);
          } catch {
            // Skip invalid entries but log
            this.logger.warn(`Skipping invalid siteUrl from GSC: ${e.siteUrl}`);
          }
        }

        return ok(entries);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          lastError = dataError("UPSTREAM_ERROR", "Search Console request timed out");
          if (attempt < 2) {
            const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return err(lastError);
        }
        // Network error
        lastError = dataError("UPSTREAM_ERROR", "RENKO couldn't reach Search Console right now.");
        if (attempt < 2) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        return err(lastError);
      }
    }

    return err(lastError ?? dataError("UNKNOWN_ERROR", "Unknown GSC error"));
  }

  private validateSiteUrlForList(): void {
    // No-op for list; siteUrl validation happens per entry
  }

  private getAnalyticsEndpoint(siteUrl: string): string {
    const base = this.config.get<string>("GSC_ANALYTICS_ENDPOINT", "https://www.googleapis.com/webmasters/v3/sites");
    // GSC requires siteUrl encoded
    return `${base}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  }

  private validatePTDate(dateStr: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw dataError("UNKNOWN_ERROR", `Invalid date format ${dateStr}, expected YYYY-MM-DD`);
    }
    const d = new Date(dateStr + "T00:00:00Z");
    if (Number.isNaN(d.getTime())) {
      throw dataError("UNKNOWN_ERROR", `Invalid date ${dateStr}`);
    }
    return d;
  }

  private validateSixteenMonthWindow(startDate: string, endDate: string): void {
    const start = this.validatePTDate(startDate);
    const end = this.validatePTDate(endDate);
    if (start.getTime() > end.getTime()) {
      throw dataError("UNKNOWN_ERROR", "startDate must be <= endDate");
    }
    const now = new Date();
    const sixteenMonthsAgo = new Date(now);
    sixteenMonthsAgo.setMonth(sixteenMonthsAgo.getMonth() - 16);
    // Allow some buffer (16 months + 5 days) for PT vs UTC
    sixteenMonthsAgo.setDate(sixteenMonthsAgo.getDate() - 5);
    if (start.getTime() < sixteenMonthsAgo.getTime()) {
      throw dataError("UNKNOWN_ERROR", "Date range outside 16-month historical limit");
    }
  }

  private async checkRateLimit(siteUrl: string): Promise<void> {
    if (!this.redis || !this.redisReady) return;
    const key = `gsc:qpm:${siteUrl}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, 60);
      }
      if (count > 1200) {
        this.logger.warn(`GSC QPM limit exceeded for ${siteUrl}: ${count}`);
        throw dataError("RATE_LIMITED", "RENKO hit a Search Console rate limit. Try again shortly.");
      }
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        throw e;
      }
      // Redis error should not block request; log and continue
      this.logger.warn(`Redis rate limit check failed for ${siteUrl}: ${e}`);
    }
  }

  async queryAnalytics(params: GscQueryParams): Promise<Result<GscAnalyticsResponse, DataError>> {
    const { workspaceId, siteUrl, startDate, endDate, dimensions, rowLimit = 25000, startRow = 0, dataState, type, aggregationType } = params;

    // Validate siteUrl
    try {
      this.validateSiteUrl(siteUrl);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        return err(e as DataError);
      }
      throw e;
    }

    // Validate dates and 16-month window
    try {
      this.validateSixteenMonthWindow(startDate, endDate);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        return err(e as DataError);
      }
      throw e;
    }

    if (rowLimit < 1 || rowLimit > 25000) {
      return err(dataError("UNKNOWN_ERROR", "rowLimit must be 1-25000"));
    }
    if (startRow < 0) {
      return err(dataError("UNKNOWN_ERROR", "startRow must be >=0"));
    }
    if (dimensions) {
      const seen = new Set<string>();
      for (const d of dimensions) {
        if (seen.has(d)) {
          return err(dataError("UNKNOWN_ERROR", `Duplicate dimension ${d}`));
        }
        seen.add(d);
      }
    }

    let accessToken: string;
    try {
      accessToken = await this.getValidAccessToken(workspaceId);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        return err(e as DataError);
      }
      throw e;
    }

    // Per-site QPM bucket
    try {
      await this.checkRateLimit(siteUrl);
    } catch (e: unknown) {
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
        return err(e as DataError);
      }
      throw e;
    }

    const endpoint = this.getAnalyticsEndpoint(siteUrl);
    const body: Record<string, unknown> = {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      startRow,
      dataState: dataState ?? "final",
      type: type ?? "web",
      aggregationType: aggregationType ?? "auto",
    };
    // Remove undefined
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

    // Retry 3x on transient 429/5xx
    let lastError: DataError | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.status === 429 || res.status === 500 || res.status === 503) {
          const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          lastError = this.mapGscError(res.status, b);
          // RATE_LIMITED is not retryable indefinitely? But per spec we retry transient 429 with backoff
          if (lastError.code === "RATE_LIMITED" && attempt < 2) {
            const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          if (lastError.code === "UPSTREAM_ERROR" && attempt < 2) {
            const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return err(lastError);
        }

        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          return err(this.mapGscError(res.status, b));
        }

        const json = (await res.json()) as unknown;

        // Zod validation
        const GscRowSchema = z.object({
          keys: z.array(z.string()),
          clicks: z.number(),
          impressions: z.number(),
          ctr: z.number().min(0).max(1),
          position: z.number().min(0),
        });
        const GscResponseSchema = z.object({
          rows: z.array(GscRowSchema).optional(),
          responseAggregationType: z.string().optional(),
          // GSC may return metadata for fresh data but we ignore for now
        });

        const parsed = GscResponseSchema.safeParse(json);
        if (!parsed.success) {
          this.logger.warn(`GSC response validation failed: ${parsed.error.message}`);
          return err(dataError("UPSTREAM_ERROR", "Invalid Search Console response"));
        }

        // Additional numeric sanity: clicks/impressions should be >=0, ctr 0-1 already via zod
        // Clamp is done in normalizer, not here; we just validate
        return ok(parsed.data as GscAnalyticsResponse);
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") {
          lastError = dataError("UPSTREAM_ERROR", "Search Console request timed out");
          if (attempt < 2) {
            const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          return err(lastError);
        }
        if (e && typeof e === "object" && "code" in (e as Record<string, unknown>)) {
          // Already a DataError (e.g., RATE_LIMITED from checkRateLimit)
          return err(e as DataError);
        }
        lastError = dataError("UPSTREAM_ERROR", "RENKO couldn't reach Search Console right now.");
        if (attempt < 2) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        return err(lastError);
      }
    }

    return err(lastError ?? dataError("UNKNOWN_ERROR", "Unknown GSC error"));
  }
}
