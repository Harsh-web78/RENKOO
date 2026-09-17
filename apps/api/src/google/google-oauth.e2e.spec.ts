import request from "supertest";
import { TokenEncryptionService } from "./token-encryption.service";
import {
  TestApp,
  createTestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
  csrfToken,
} from "../test-utils/e2e-fixtures";

describe("Google OAuth (Prompt 8)", () => {
  // Throttle budget (production limits, unchanged): /start allows 5/min
  // per app instance (in-memory store). Start-consuming tests are spread
  // across isolated apps — guards and security assertions are identical
  // inside each instance:
  //   AppMain: cookie attrs, scopes, missing/mismatched state, token failure (4 starts)
  //   rate-test app: 6 rapid starts → exact [302×5, 429] contract proof
  //   App2: success callback, connection status, revoke flow (3 starts)
  let app1: TestApp;
  let encryption: TokenEncryptionService;
  let app2: TestApp | null = null;
  const originalFetch = global.fetch;

  const uniqueEmail = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  const strongPassword = "Renko123!";

  // Mock helpers
  function mockGoogleSuccess() {
    const fakeIdToken = (() => {
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ email: "google-user@example.test", sub: "123" })).toString("base64url");
      return `${header}.${payload}.`;
    })();

    global.fetch = jest.fn().mockImplementation(async (input: unknown) => {
      const urlStr = String(input);
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "mock_access_token_123",
            expires_in: 3600,
            refresh_token: "mock_refresh_token_456",
            scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
            token_type: "Bearer",
            id_token: fakeIdToken,
          }),
        } as unknown as Response;
      }
      if (urlStr.includes("googleapis.com/oauth2")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: "google-user@example.test", verified_email: true }),
        } as unknown as Response;
      }
      if (urlStr.includes("oauth2.googleapis.com/revoke")) {
        return { ok: true, status: 200, text: async () => "ok", json: async () => ({}) } as unknown as Response;
      }
      // fallback to original
      return (originalFetch as unknown as typeof fetch)(input as string);
    }) as unknown as typeof fetch;
  }

  function mockGoogleTokenFailure() {
    global.fetch = jest.fn().mockImplementation(async (input: unknown) => {
      const urlStr = String(input);
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "invalid_grant", error_description: "Bad code" }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  function mockGoogleRevokeFailure() {
    global.fetch = jest.fn().mockImplementation(async (input: unknown) => {
      const urlStr = String(input);
      if (urlStr.includes("oauth2.googleapis.com/token")) {
        const fakeIdToken = (() => {
          const h = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
          const p = Buffer.from(JSON.stringify({ email: "google-user@example.test" })).toString("base64url");
          return `${h}.${p}.`;
        })();
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "mock_access",
            expires_in: 3600,
            refresh_token: "mock_refresh",
            scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
            token_type: "Bearer",
            id_token: fakeIdToken,
          }),
        } as unknown as Response;
      }
      if (urlStr.includes("oauth2.googleapis.com/revoke")) {
        return { ok: false, status: 500, text: async () => "revoke failed", json: async () => ({}) } as unknown as Response;
      }
      if (urlStr.includes("userinfo")) {
        return { ok: true, status: 200, json: async () => ({ email: "google-user@example.test" }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  async function secondApp(): Promise<TestApp> {
    if (!app2) app2 = await createTestApp();
    return app2;
  }

  beforeAll(async () => {
    app1 = await createTestApp();
    await truncateAll(app1.prisma);
    encryption = app1.app.get(TokenEncryptionService);
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
    if (app2) await closeTestApp(app2);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  describe("TokenEncryptionService", () => {
    it("encryption/decryption round trip", () => {
      const plain = "my-secret-token-123";
      const enc = encryption.encrypt(plain);
      expect(enc).not.toBe(plain);
      const dec = encryption.decrypt(enc);
      expect(dec).toBe(plain);
    });

    it("tampered ciphertext fails authentication", () => {
      const enc = encryption.encrypt("hello world");
      const buf = Buffer.from(enc, "base64");
      // Flip last byte
      buf[buf.length - 1] = (buf[buf.length - 1]! ^ 0xff) as number;
      const tampered = buf.toString("base64");
      expect(() => encryption.decrypt(tampered)).toThrow();
    });

    it("encryption uses different IVs for repeated encryptions", () => {
      const plain = "same plaintext";
      const e1 = encryption.encrypt(plain);
      const e2 = encryption.encrypt(plain);
      expect(e1).not.toBe(e2);
      expect(encryption.decrypt(e1)).toBe(plain);
      expect(encryption.decrypt(e2)).toBe(plain);
    });

    it("keyVersion is 1", () => {
      expect(encryption.getKeyVersion()).toBe(1);
    });
  });

  describe("OAuth start", () => {
    it("requires authentication 401", async () => {
      await request(app1.app.getHttpServer()).get("/api/v1/auth/google/start").expect(401);
    });

    it("generates state and sets oauth_state cookie with security attributes", async () => {
      const { agent } = await signupAgent(app1.app, "oauth-start");
      const res = await agent.get("/api/v1/auth/google/start").expect(302);
      // Check oauth_state cookie via headers
      const raw = res.headers["set-cookie"] as unknown as string | string[] | undefined;
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const oauthCookie = arr.find((c) => c.includes("oauth_state"));
      expect(oauthCookie).toBeDefined();
      expect(oauthCookie).toMatch(/HttpOnly/i);
      expect(oauthCookie).toMatch(/SameSite=Lax/i);
      expect(oauthCookie).toMatch(/Path=\/api\/v1\/auth\/google/i);
      expect(oauthCookie).toMatch(/Max-Age=600/i);
      // Secure false in test
      expect(oauthCookie).not.toMatch(/Secure/i);
      const location = res.headers.location as string;
      expect(location).toContain("accounts.google.com");
    });

    it("redirect URL contains client_id, offline access, expected scopes", async () => {
      const { agent } = await signupAgent(app1.app, "oauth-scopes");
      const res = await agent.get("/api/v1/auth/google/start").expect(302);
      const location = res.headers.location as string;
      expect(location).toContain("client_id=test-client-id.apps.googleusercontent.com");
      expect(location).toContain("access_type=offline");
      expect(location).toContain("prompt=consent");
      expect(location).toContain(encodeURIComponent("https://www.googleapis.com/auth/webmasters.readonly"));
      expect(location).toContain("openid");
      expect(location).toContain("email");
      expect(location).not.toContain("client_secret");
      // Never accept client-supplied redirect
      expect(location).toContain(encodeURIComponent("http://localhost:3000/api/v1/auth/google/callback"));
    });

    it("rate limit 5/min — exact contract: five 302s then 429 (isolated app)", async () => {
      const rateApp = await createTestApp();
      try {
        const { agent } = await signupAgent(rateApp.app, "oauth-rate");
        const statuses: number[] = [];
        for (let i = 0; i < 6; i++) {
          const r = await agent.get("/api/v1/auth/google/start");
          statuses.push(r.status);
        }
        expect(statuses.slice(0, 5)).toEqual([302, 302, 302, 302, 302]);
        expect(statuses[5]).toBe(429);
      } finally {
        await closeTestApp(rateApp);
      }
    });
  });

  describe("OAuth callback state validation", () => {
    it("missing state → 403", async () => {
      const { agent } = await signupAgent(app1.app, "cb-missing");
      // Need to have session but no state stored
      await agent.get("/api/v1/auth/google/callback?code=abc&state=missing").expect(403);
    });

    it("mismatched state → 403", async () => {
      const { agent } = await signupAgent(app1.app, "cb-mismatch");
      await agent.get("/api/v1/auth/google/start").expect(302);
      // Use wrong state
      await agent.get("/api/v1/auth/google/callback?code=abc&state=wrong_state_value_1234567890").expect(403);
    });

    it("token exchange failure handled safely (redirect with error, not 500)", async () => {
      mockGoogleTokenFailure();
      const { agent } = await signupAgent(app1.app, "cb-tokenfail");
      const startRes = await agent.get("/api/v1/auth/google/start").expect(302);
      // Extract state from redirect location
      const location = startRes.headers.location as string;
      const state = new URL(location).searchParams.get("state")!;
      // Need to keep oauth_state cookie — supertest agent already stores it
      const cb = await agent.get(`/api/v1/auth/google/callback?code=badcode&state=${state}`).expect(302);
      expect(cb.headers.location as string).toContain("status=error");
    });
  });

  describe("Successful callback and storage", () => {
    it("stores encrypted tokens, never exposes plaintext, ciphertext not returned", async () => {
      const t2 = await secondApp();
      mockGoogleSuccess();
      const { agent, workspaceId } = await signupAgent(t2.app, "cb-success");
      const startRes = await agent.get("/api/v1/auth/google/start").expect(302);
      const state = new URL(startRes.headers.location as string).searchParams.get("state")!;
      const cbRes = await agent.get(`/api/v1/auth/google/callback?code=validcode&state=${state}`).expect(302);
      expect(cbRes.headers.location as string).toContain("status=connected");
      // Check DB stores encrypted
      const conn = await t2.prisma.searchConsoleConnection.findUnique({ where: { workspaceId } });
      expect(conn).not.toBeNull();
      expect(conn!.encryptedAccessToken).not.toBe("mock_access_token_123");
      expect(conn!.encryptedRefreshToken).not.toBe("mock_refresh_token_456");
      expect(conn!.encryptedAccessToken).not.toContain("mock_access_token");
      // Decrypt and verify round-trip
      const appEncryption = t2.app.get(TokenEncryptionService);
      const decAccess = appEncryption.decrypt(conn!.encryptedAccessToken);
      expect(decAccess).toBe("mock_access_token_123");
      const decRefresh = appEncryption.decrypt(conn!.encryptedRefreshToken);
      expect(decRefresh).toBe("mock_refresh_token_456");
      // Ensure API never returns encrypted ciphertext via status endpoint
      const statusRes = await agent.get(`/api/v1/workspaces/${workspaceId}/connections/status`).expect(200);
      const bodyStr = JSON.stringify(statusRes.body);
      expect(bodyStr).not.toContain("mock_access_token_123");
      expect(bodyStr).not.toContain("mock_refresh_token_456");
      expect(bodyStr).not.toContain(conn!.encryptedAccessToken);
      expect(bodyStr).not.toContain(conn!.encryptedRefreshToken);
      expect(statusRes.body.connected).toBe(true);
      expect(statusRes.body.googleAccountEmail).toBe("google-user@example.test");
      expect(statusRes.body.scopes).toEqual(expect.arrayContaining(["https://www.googleapis.com/auth/webmasters.readonly"]));
    });

    it("connection status works and cross-workspace denied", async () => {
      const t2 = await secondApp();
      mockGoogleSuccess();
      const { agent: agentA, workspaceId: wsA } = await signupAgent(t2.app, "conn-a");
      const { agent: agentB, workspaceId: wsB } = await signupAgent(t2.app, "conn-b");

      // Connect A
      const startA = await agentA.get("/api/v1/auth/google/start").expect(302);
      const stateA = new URL(startA.headers.location as string).searchParams.get("state")!;
      await agentA.get(`/api/v1/auth/google/callback?code=codeA&state=${stateA}`).expect(302);

      // A can see own status
      const resA = await agentA.get(`/api/v1/workspaces/${wsA}/connections/status`).expect(200);
      expect(resA.body.connected).toBe(true);

      // B cannot see A's status
      await agentB.get(`/api/v1/workspaces/${wsA}/connections/status`).expect(403);
      // A cannot see B's (B not connected, but also isolated — should be 403 or 200 with not connected? Actually B is owner of B, so A accessing B should be 403)
      await agentA.get(`/api/v1/workspaces/${wsB}/connections/status`).expect(403);
    });
  });

  describe("Revoke", () => {
    it("requires authentication 401", async () => {
      const t2 = await secondApp();
      await request(t2.app.getHttpServer()).post("/api/v1/auth/google/revoke").send({}).expect(401);
    });

    it("requires CSRF 403", async () => {
      const t2 = await secondApp();
      const { agent } = await signupAgent(t2.app, "revoke-csrf");
      // No CSRF token
      await agent.post("/api/v1/auth/google/revoke").send({}).expect(403);
    });

    it("revoke never exposes token and handles Google errors safely (idempotent)", async () => {
      const t2 = await secondApp();
      mockGoogleSuccess();
      const { agent, workspaceId: wsId } = await signupAgent(t2.app, "revoke-ok");
      const start = await agent.get("/api/v1/auth/google/start").expect(302);
      const state = new URL(start.headers.location as string).searchParams.get("state")!;
      await agent.get(`/api/v1/auth/google/callback?code=code&state=${state}`).expect(302);

      // Get CSRF
      const token = await csrfToken(agent);

      // Now mock revoke failure
      mockGoogleRevokeFailure();
      const res = await agent.post("/api/v1/auth/google/revoke").set("x-csrf-token", token).send({ workspaceId: wsId }).expect(200);
      expect(JSON.stringify(res.body)).not.toContain("mock_access");
      expect(JSON.stringify(res.body)).not.toContain("mock_refresh");
      // Should still delete local connection even though Google failed
      const status = await agent.get(`/api/v1/workspaces/${wsId}/connections/status`).expect(200);
      expect(status.body.connected).toBe(false);

      // Idempotent second revoke
      const token2 = await csrfToken(agent);
      await agent.post("/api/v1/auth/google/revoke").set("x-csrf-token", token2).send({ workspaceId: wsId }).expect(200);
    });
  });
});
