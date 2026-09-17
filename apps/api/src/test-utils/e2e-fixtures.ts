import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import cookieParser from "cookie-parser";
import session from "express-session";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Shared E2E fixtures (Prompt 15 — test infrastructure only).
 *
 * Production throttling is intentional and unchanged:
 *   global 60/min/IP · sign-up 20/min · log-in 10/min · csrf 30/min
 *   properties/sync 1/5min · ingest 10/min · oauth/start 5/min
 * Throttler state lives per app instance (in-memory store), so each
 * `createTestApp()` gets a pristine budget. Suites stay inside budget by:
 *   - ONE expensive setup (sync/ingest) per app lifetime, shared across tests
 *   - direct-DB rows (via Prisma) for setup-only state, never for the
 *     endpoint under test (that endpoint is always exercised through HTTP)
 *   - additional isolated app instances only where tests need mutually
 *     exclusive throttle-bucket states (e.g. two different sync outcomes)
 *
 * Nothing here touches production code paths.
 */

export const STRONG_PASSWORD = "Renko123!";

export const uniqueEmail = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestApp> {
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
      store: new session.MemoryStore(),
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

export async function closeTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  await testApp.prisma.$disconnect().catch(() => {});
}

export async function truncateAll(prisma: PrismaService): Promise<void> {
  await prisma.ingestionJob.deleteMany().catch(() => {});
  await prisma.fixOutcome.deleteMany().catch(() => {});
  await prisma.fix.deleteMany().catch(() => {});
  await prisma.recommendation.deleteMany().catch(() => {});
  await prisma.searchDataSnapshot.deleteMany().catch(() => {});
  await prisma.searchProperty.deleteMany().catch(() => {});
  await prisma.searchConsoleConnection.deleteMany().catch(() => {});
  await prisma.workspaceMember.deleteMany().catch(() => {});
  await prisma.workspace.deleteMany().catch(() => {});
  await prisma.user.deleteMany().catch(() => {});
}

/** Signs up a fresh user over HTTP (also establishes the agent session). */
export async function signupAgent(
  app: INestApplication,
  tag: string,
): Promise<{ agent: any; email: string; workspaceId: string; userId: string }> {
  const email = uniqueEmail(tag);
  const agent = request.agent(app.getHttpServer());
  const signup = await agent.post("/api/v1/auth/sign-up").send({ email, password: STRONG_PASSWORD }).expect(201);
  return {
    agent,
    email,
    workspaceId: signup.body.workspace.id as string,
    userId: signup.body.user.id as string,
  };
}

export async function csrfToken(agent: any): Promise<string> {
  const res = await agent.get("/api/v1/auth/csrf").expect(200);
  return res.body.csrfToken as string;
}

/**
 * Inserts a SearchProperty row directly (setup-only; the sync endpoint
 * itself is covered by dedicated tests). Mirrors what
 * `SearchConsoleService.syncProperties` stores for a mock entry.
 */
export async function createPropertyRow(
  prisma: PrismaService,
  params: {
    workspaceId: string;
    siteUrl?: string;
    displayName?: string;
    type?: "domain" | "url_prefix";
    permissionLevel?: "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser";
    status?: "healthy" | "needs_attention" | "stale" | "disconnected";
    isSelectable?: boolean;
  },
): Promise<{ id: string; siteUrl: string }> {
  const siteUrl = params.siteUrl ?? `sc-domain:fixture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.test`;
  const row = await prisma.searchProperty.create({
    data: {
      workspaceId: params.workspaceId,
      siteUrl,
      displayName: params.displayName ?? siteUrl.replace(/^sc-domain:/, ""),
      type: params.type ?? "domain",
      permissionLevel: params.permissionLevel ?? "siteOwner",
      status: params.status ?? "healthy",
      isSelectable: params.isSelectable ?? true,
      siteOrigin: siteUrl.startsWith("sc-domain:") ? `https://${siteUrl.slice("sc-domain:".length)}` : siteUrl,
    },
  });
  return { id: row.id, siteUrl: row.siteUrl };
}

/**
 * Test-only divergent snapshot fixture (Defect 2 fix).
 *
 * Root cause: the mock GSC provider returns identical rows for the current
 * and prior windows, so the real engine correctly yields `no-signal`.
 * Production code and mock behavior are unchanged; this helper writes a
 * real `SearchDataSnapshot` row directly to the test DB whose normalized
 * current/prior pages deterministically produce exactly ONE
 * `ctr-below-expected` recommendation:
 *   current  /pricing: 3000 impr, ctr 0.020, pos 4.5
 *   prior    /pricing: 2900 impr, ctr 0.031, pos 4.3
 *   decline 0.011 absolute / ~35% relative (thresholds 0.005 / 15%)
 *   position delta +0.2 (below 1.0) and top-query CTR 2.6% (above 2.0% gap
 *   threshold), so no competing signal fires.
 *
 * The endpoint under test is still exercised through HTTP; only setup
 * state is seeded via Prisma. The row is the latest snapshot
 * (`retrievedAt` = now, later than any mock ingest row), so
 * `RecommendationService` evaluates it. Returns the created snapshot id.
 */
export async function seedSignalSnapshot(
  prisma: PrismaService,
  params: { workspaceId: string; propertyId: string; siteUrl: string; displayName?: string },
): Promise<{ id: string }> {
  const now = new Date();
  const periodStart = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
  const normalizedJson = {
    meta: {
      source: { id: "google-search-console", label: "Google Search Console" },
      property: {
        id: params.propertyId,
        name: params.displayName ?? params.siteUrl.replace(/^sc-domain:/, ""),
        type: "domain",
        siteUrl: params.siteUrl,
      },
      period: { start: periodStart.toISOString(), end: now.toISOString(), label: "Last 28 days vs. prior 28 days" },
      dataThrough: now.toISOString(),
      retrievedAt: now.toISOString(),
      freshness: "fresh",
      quality: "complete",
      limitations: ["Page/query grouping may omit low-volume data for performance."],
    },
    page: { page: "/pricing", clicks: 60, impressions: 3000, ctr: 0.02, position: 4.5 },
    comparisonPage: { page: "/pricing", clicks: 90, impressions: 2900, ctr: 0.031, position: 4.3 },
    queries: [
      { query: "pricing plans", clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 },
      { query: "renko pricing", clicks: 18, impressions: 640, ctr: 0.028, position: 3.9 },
    ],
  };
  const row = await prisma.searchDataSnapshot.create({
    data: {
      workspaceId: params.workspaceId,
      propertyId: params.propertyId,
      siteUrl: params.siteUrl,
      periodStart,
      periodEnd: now,
      periodLabel: "Last 28 days vs. prior 28 days",
      dataThrough: now,
      retrievedAt: now,
      freshness: "fresh",
      quality: "complete",
      limitations: [],
      normalizedJson: normalizedJson as any,
      rawResponseHash: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      rowCount: 5,
    },
  });
  return { id: row.id };
}
