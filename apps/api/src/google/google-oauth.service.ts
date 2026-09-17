import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { TokenEncryptionService } from "./token-encryption.service";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

interface UserInfoResponse {
  email?: string;
  verified_email?: boolean;
  id?: string;
  name?: string;
}

@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: TokenEncryptionService,
  ) {}

  getClientId(): string {
    return this.config.get<string>("GOOGLE_CLIENT_ID", "");
  }

  getClientSecret(): string {
    return this.config.get<string>("GOOGLE_CLIENT_SECRET", "");
  }

  getRedirectUri(): string {
    return this.config.get<string>("GOOGLE_REDIRECT_URI", "");
  }

  getFrontendUrl(): string {
    return this.config.get<string>("FRONTEND_URL", "http://localhost:3001");
  }

  getAuthEndpoint(): string {
    return this.config.get<string>("GOOGLE_AUTH_ENDPOINT", "https://accounts.google.com/o/oauth2/v2/auth");
  }

  getTokenEndpoint(): string {
    return this.config.get<string>("GOOGLE_TOKEN_ENDPOINT", "https://oauth2.googleapis.com/token");
  }

  getRevokeEndpoint(): string {
    return this.config.get<string>("GOOGLE_REVOKE_ENDPOINT", "https://oauth2.googleapis.com/revoke");
  }

  getUserinfoEndpoint(): string {
    return this.config.get<string>("GOOGLE_USERINFO_ENDPOINT", "https://www.googleapis.com/oauth2/v2/userinfo");
  }

  buildAuthorizationUrl(state: string): string {
    const clientId = this.getClientId();
    const redirectUri = this.getRedirectUri();
    if (!clientId || !redirectUri) {
      throw new Error("Google OAuth not configured: GOOGLE_CLIENT_ID/GOOGLE_REDIRECT_URI required");
    }
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${this.getAuthEndpoint()}?${params.toString()}`;
  }

  async exchangeCodeForTokens(code: string): Promise<TokenResponse> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();
    const redirectUri = this.getRedirectUri();
    const tokenEndpoint = this.getTokenEndpoint();

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error as string) ?? "token_exchange_failed";
      const desc = (json.error_description as string) ?? `Token exchange failed: ${res.status}`;
      this.logger.warn(`Token exchange failed ${res.status} ${err}`);
      throw new Error(`${err}: ${desc}`);
    }

    if (!json.access_token || typeof json.access_token !== "string") {
      throw new Error("Token response missing access_token");
    }
    return json as unknown as TokenResponse;
  }

  async fetchGoogleEmail(accessToken: string, idToken?: string): Promise<string | undefined> {
    // Try to decode id_token first (no network) if present
    if (idToken) {
      try {
        const parts = idToken.split(".");
        if (parts.length === 3 && parts[1]) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
          if (typeof payload.email === "string") {
            return payload.email as string;
          }
        }
      } catch {
        // fall through to userinfo endpoint
      }
    }

    const endpoint = this.getUserinfoEndpoint();
    try {
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`Userinfo fetch failed ${res.status}`);
        return undefined;
      }
      const data = (await res.json()) as UserInfoResponse;
      return data.email;
    } catch (err) {
      this.logger.warn(`Userinfo fetch error: ${err}`);
      return undefined;
    }
  }

  async revokeToken(token: string): Promise<void> {
    const endpoint = this.getRevokeEndpoint();
    // Google revoke expects application/x-www-form-urlencoded with token
    const body = new URLSearchParams({ token });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.warn(`Google revoke returned ${res.status}: ${text}`);
        // Don't throw — revocation is best-effort, we still delete local connection
      }
    } catch (err) {
      this.logger.warn(`Revoke network error: ${err}`);
      // Still proceed to delete local connection
    }
  }

  async upsertConnection(params: {
    workspaceId: string;
    userId: string;
    accessToken: string;
    refreshToken?: string;
    expiresIn: number;
    scopes?: string;
    googleEmail?: string;
  }): Promise<void> {
    const { workspaceId, userId, accessToken, refreshToken, expiresIn, scopes, googleEmail } = params;
    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + expiresIn * 1000);
    const encryptedAccess = this.encryption.encrypt(accessToken);
    const keyVersion = this.encryption.getKeyVersion();

    // Refresh token: if not returned (Google only on first consent), keep existing encrypted one
    let encryptedRefresh = "";
    let refreshExpiresAt: Date | null = null;
    if (refreshToken) {
      encryptedRefresh = this.encryption.encrypt(refreshToken);
    } else {
      // Try to retain existing refresh token if present
      const existing = await this.prisma.searchConsoleConnection.findUnique({ where: { workspaceId } });
      if (existing) {
        encryptedRefresh = existing.encryptedRefreshToken;
        refreshExpiresAt = existing.refreshTokenExpiresAt;
      } else {
        // No refresh token and no existing — upsert will fail if we store empty; but we should allow?
        // For Prompt 8, require refresh_token on first connect; if missing, store empty and mark error
        encryptedRefresh = this.encryption.encrypt("__missing_refresh_token__");
        this.logger.warn(`No refresh_token for workspace ${workspaceId} — storing placeholder`);
      }
    }

    const scopeArray = scopes ? scopes.split(" ").filter(Boolean) : ["https://www.googleapis.com/auth/webmasters.readonly", "openid", "email"];

    await this.prisma.searchConsoleConnection.upsert({
      where: { workspaceId },
      update: {
        userId,
        encryptedAccessToken: encryptedAccess,
        ...(refreshToken ? { encryptedRefreshToken: encryptedRefresh } : {}),
        accessTokenExpiresAt: accessExpiresAt,
        ...(refreshExpiresAt ? {} : {}),
        scopes: scopeArray,
        googleAccountEmail: googleEmail,
        status: "connected",
        keyVersion,
        lastRefreshedAt: now,
      },
      create: {
        workspaceId,
        userId,
        encryptedAccessToken: encryptedAccess,
        encryptedRefreshToken: encryptedRefresh,
        accessTokenExpiresAt: accessExpiresAt,
        refreshTokenExpiresAt: refreshExpiresAt,
        scopes: scopeArray,
        googleAccountEmail: googleEmail,
        status: "connected",
        keyVersion,
        lastRefreshedAt: now,
      },
    });

    this.logger.log(`Upserted connection workspace ${workspaceId} email ${googleEmail ?? "unknown"}`);
  }

  async getConnectionStatus(workspaceId: string): Promise<{
    status: string;
    googleAccountEmail: string | null;
    scopes: string[];
    connectedAt: string | null;
    accessTokenExpiresAt: string | null;
    keyVersion: number | null;
  } | null> {
    const conn = await this.prisma.searchConsoleConnection.findUnique({ where: { workspaceId } });
    if (!conn) return null;
    return {
      status: conn.status,
      googleAccountEmail: conn.googleAccountEmail,
      scopes: conn.scopes,
      connectedAt: conn.createdAt.toISOString(),
      accessTokenExpiresAt: conn.accessTokenExpiresAt.toISOString(),
      keyVersion: conn.keyVersion,
    };
  }

  async deleteConnection(workspaceId: string): Promise<void> {
    await this.prisma.searchConsoleConnection.deleteMany({ where: { workspaceId } });
  }

  async revokeConnection(workspaceId: string): Promise<void> {
    const conn = await this.prisma.searchConsoleConnection.findUnique({ where: { workspaceId } });
    if (!conn) return;
    let tokenToRevoke = "";
    try {
      // Prefer refresh token, fallback to access token
      if (conn.encryptedRefreshToken) {
        const dec = this.encryption.decrypt(conn.encryptedRefreshToken);
        if (dec !== "__missing_refresh_token__") tokenToRevoke = dec;
      }
      if (!tokenToRevoke && conn.encryptedAccessToken) {
        tokenToRevoke = this.encryption.decrypt(conn.encryptedAccessToken);
      }
    } catch {
      // If decrypt fails (tampered), still delete local
      tokenToRevoke = "";
    }
    if (tokenToRevoke) {
      await this.revokeToken(tokenToRevoke);
    }
    await this.deleteConnection(workspaceId);
  }
}
