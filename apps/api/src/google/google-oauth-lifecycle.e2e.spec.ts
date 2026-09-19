import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import cookieParser from "cookie-parser";
import session from "express-session";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import {
  TestApp,
  closeTestApp,
  truncateAll,
  signupAgent,
} from "../test-utils/e2e-fixtures";

/**
 * OAuth session lifecycle (production incident follow-up).
 *
 * Production returned 403 "Missing OAuth state." at the callback even though
 * `/start` had issued a 302. Human-speed OAuth takes minutes while a Redis
 * write takes milliseconds, so the state was not merely late — it was
 * absent at callback time. This spec pins the complete lifecycle against a
 * single instance to prove exactly where oauthState lives or disappears:
 *
 *   1. GET /start → 302 + Set-Cookie(oauth_state) + state in Location
 *   2. GET /callback with the SAME cookies → session retrieval → connected
 *   3. negatives: missing cookie jar, replayed state, store GET failure
 *
 * Throttle budget: /start allows 5/min per app; starts are spread across
 * two isolated app instances (3 + 1).
 */
class ControllableStore extends session.MemoryStore {
  failSet = false;
  failGet = false;

  override set(
    sid: string,
    sess: session.SessionData,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback?: (err?: any) => void,
  ): void {
    if (this.failSet) {
      if (callback) process.nextTick(() => callback(new Error("STORE_DOWN")));
      return;
    }
    super.set(sid, sess, callback);
  }

  override get(
    sid: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (err?: any, session?: session.SessionData | null) => void,
  ): void {
    if (this.failGet) {
      process.nextTick(() => callback(new Error("STORE_DOWN")));
      return;
    }
    super.get(sid, callback);
  }
}

interface LifecycleApp extends TestApp {
  store: ControllableStore;
}

async function createLifecycleApp(): Promise<LifecycleApp> {
  process.env.GSC_MOCK = "true";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 0x02).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/v1/auth/google/callback";
  process.env.SESSION_SECRET = "test-session-secret-change-in-production-32chars!!";

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  const store = new ControllableStore();
  app.use(
    session({
      name: "renko.sid",
      secret: process.env.SESSION_SECRET!,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" },
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, store };
}

function mockGoogleSuccess(): void {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ email: "google-user@example.test", sub: "123" })).toString("base64url");
  const fakeIdToken = `${header}.${payload}.`;
  global.fetch = jest.fn().mockImplementation(async (input: unknown) => {
    const urlStr = String(input);
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "lifecycle_access",
          expires_in: 3600,
          refresh_token: "lifecycle_refresh",
          scope: "https://www.googleapis.com/auth/webmasters.readonly openid email",
          token_type: "Bearer",
          id_token: fakeIdToken,
        }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
}

const originalFetch = global.fetch;

describe("Google OAuth session lifecycle", () => {
  let app1: LifecycleApp;
  let app2: LifecycleApp;

  beforeAll(async () => {
    app1 = await createLifecycleApp();
    app2 = await createLifecycleApp();
    await truncateAll(app1.prisma);
  });

  afterEach(() => {
    app1.store.failSet = false;
    app1.store.failGet = false;
    app2.store.failSet = false;
    app2.store.failGet = false;
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    await truncateAll(app1.prisma);
    await closeTestApp(app1);
    await closeTestApp(app2);
  });

  it("L1. start issues state + cookies; callback with the SAME cookies retrieves oauthState (connected)", async () => {
    mockGoogleSuccess();
    const { agent } = await signupAgent(app1.app, "lifecycle-rt");
    const start = await agent.get("/api/v1/auth/google/start").expect(302);

    // Both halves of the dual check must be settable on the client.
    const raw = start.headers["set-cookie"] as unknown as string | string[] | undefined;
    const cookies = Array.isArray(raw) ? raw : raw ? [raw] : [];
    expect(cookies.some((c) => c.includes("oauth_state"))).toBe(true);

    const state = new URL(start.headers.location as string).searchParams.get("state");
    expect(state).toBeTruthy();

    // Same cookie jar (session cookie + oauth_state) → session retrieval works.
    const cb = await agent.get(`/api/v1/auth/google/callback?code=code123&state=${state}`).expect(302);
    expect(cb.headers.location as string).toContain("status=connected");
  });

  it("L2. callback with NO cookies cannot retrieve oauthState → 403 Missing", async () => {
    const { agent } = await signupAgent(app1.app, "lifecycle-nocookie");
    const start = await agent.get("/api/v1/auth/google/start").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state")!;

    // Fresh client: no session cookie, no oauth_state cookie (simulates the
    // browser failing to send cookies on the Google → API navigation).
    const bare = request(app1.app.getHttpServer());
    const res = await bare.get(`/api/v1/auth/google/callback?code=code123&state=${state}`).expect(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(res.body.message).toBe("Missing OAuth state.");
  });

  it("L3. replayed state is rejected (state cleared after first use)", async () => {
    mockGoogleSuccess();
    const { agent } = await signupAgent(app1.app, "lifecycle-replay");
    const start = await agent.get("/api/v1/auth/google/start").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    await agent.get(`/api/v1/auth/google/callback?code=code123&state=${state}`).expect(302);
    // Second use of the same state must fail — replay protection intact.
    await agent.get(`/api/v1/auth/google/callback?code=code123&state=${state}`).expect(403);
  });

  it("L4. session-store GET failure at callback → generic 500, no internals leaked", async () => {
    const { agent } = await signupAgent(app2.app, "lifecycle-storefail");
    const start = await agent.get("/api/v1/auth/google/start").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state")!;
    app2.store.failGet = true;
    try {
      const res = await agent.get(`/api/v1/auth/google/callback?code=code123&state=${state}`).expect(500);
      expect(res.body.code).toBe("UNKNOWN_ERROR");
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/STORE_DOWN|oauthState|Prisma|stack|at .*\(/i);
    } finally {
      app2.store.failGet = false;
    }
  });
});
