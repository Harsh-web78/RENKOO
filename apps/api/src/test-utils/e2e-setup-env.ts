/**
 * E2E env bootstrap (test infrastructure only).
 *
 * Root cause: `@Module({ imports: [ConfigModule.forRoot(...)] })` in
 * `app.module.ts` evaluates `forRoot()` at IMPORT time (decorator arguments
 * run when the module file is first imported). @nestjs/config v4 then
 * synchronously snapshots `{...envFile, ...process.env}`, validates it, and
 * captures the result for the ConfigService store. `createTestApp()` only
 * assigns the `GOOGLE_*`/`SESSION_SECRET` test overrides afterwards, which
 * is too late for ConfigService consumers (e.g. the OAuth redirect emitted
 * the placeholder client_id from `.env` instead of the test client_id).
 *
 * `setupFiles` entries run BEFORE any test module is imported, so assigning
 * the same test values here guarantees ConfigService snapshots them.
 * Production code, throttling, and mock behavior are untouched.
 *
 * DATABASE_URL/REDIS_URL are intentionally NOT set here: they stay ambient
 * (shell env in CI/local, `.env` file fallback) so the suites can target
 * whichever database the operator provides.
 */

process.env.GSC_MOCK = "true";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 0x02).toString("base64");
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/v1/auth/google/callback";
process.env.SESSION_SECRET = "test-session-secret-change-in-production-32chars!!";

export {};
