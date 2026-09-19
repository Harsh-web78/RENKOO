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
 * OAuth session-persistence gate (production hardening).
 *
 * Root cause: `/auth/google/start` used to rely on implicit end-of-response
 * session persistence before the 302 to Google. With a Redis store that
 * write can fail after the redirect is out, and the callback then finds an
 * empty session → 403 "Missing OAuth state.". `start` now awaits
 * `req.session.save()` and fails closed with 503 OAUTH_SESSION_UNAVAILABLE
 * instead of sending the user to Google with doomed state.
 *
 * The failing store below fails persistence ONLY for sessions carrying
 * oauthState — i.e. it simulates Redis dying between login and OAuth start,
 * while login itself keeps working. Throttle budget: one app, one start call.
 */
class OAuthStateFailingStore extends session.MemoryStore {
  override set(
    sid: string,
    sess: session.SessionData,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback?: (err?: any) => void,
  ): void {
    const data = sess as unknown as Record<string, unknown>;
    if (data && data.oauthState !== undefined) {
      if (callback) process.nextTick(() => callback(new Error("REDIS_UNAVAILABLE")));
      return;
    }
    super.set(sid, sess, callback);
  }
}

async function createFailingStoreApp(): Promise<TestApp> {
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
  app.use(
    session({
      name: "renko.sid",
      secret: process.env.SESSION_SECRET!,
      store: new OAuthStateFailingStore(),
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
  return { app, prisma };
}

describe("Google OAuth session persistence gate", () => {
  let testApp: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    testApp = await createFailingStoreApp();
    app = testApp.app;
    await truncateAll(testApp.prisma);
  });

  afterAll(async () => {
    await truncateAll(testApp.prisma);
    await closeTestApp(testApp);
  });

  it("start fails closed with 503 when OAuth state cannot be persisted (no redirect to Google)", async () => {
    const { agent, workspaceId } = await signupAgent(app, "oauth-persist");
    const res = await agent
      .get(`/api/v1/auth/google/start?workspaceId=${encodeURIComponent(workspaceId)}`)
      .expect(503);
    expect(res.body.code).toBe("OAUTH_SESSION_UNAVAILABLE");
    // Must NOT redirect to Google with doomed state.
    expect(res.headers.location).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\(/i);
  });
});
