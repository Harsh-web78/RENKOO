# Production checklist (Prompt 14 §12/§16)

No production values are invented here. Every item is either READY in
code, REQUIRES CONFIGURATION (operator-supplied), or BLOCKED BY LOCAL
ENVIRONMENT (unverifiable on this machine).

## Environment variables (server)

| Variable | Status | Notes |
|---|---|---|
| `DATABASE_URL` | REQUIRES CONFIGURATION | `postgresql://user:pass@host:5432/renko` with TLS in prod. Validated `uri().required()` at boot. |
| `REDIS_URL` | REQUIRES CONFIGURATION | `redis://` or `rediss://`. Required by validation; sessions degrade gracefully if unreachable, ingestion executes directly. |
| `SESSION_SECRET` | REQUIRES CONFIGURATION | Strong random ≥32 chars. Boot **throws in production** if left as the distributed default. |
| `GOOGLE_CLIENT_ID` | REQUIRES CONFIGURATION | Must end `.apps.googleusercontent.com`. Empty (default) disables OAuth with `OAUTH_NOT_CONFIGURED`. |
| `GOOGLE_CLIENT_SECRET` | REQUIRES CONFIGURATION | From Google Cloud Console. Never logged; sent only server-to-server during code exchange. |
| `GOOGLE_REDIRECT_URI` | REQUIRES CONFIGURATION | Exact match of the whitelisted Console URI, e.g. `https://api.renko.app/api/v1/auth/google/callback`. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | REQUIRES CONFIGURATION | Base64 of 32 random bytes (validated). Boot **throws in production** if missing. Rotate via `keyVersion` column (dual-key fallback structured, not yet wired). |
| `FRONTEND_URL` | REQUIRES CONFIGURATION | Prod origin, e.g. `https://www.renko.app`. Used for CORS `origin` (credentials) and OAuth callback redirects. |
| `NODE_ENV` | REQUIRES CONFIGURATION | Must be `production` (enables `Secure` cookies, disables dev key fallbacks). |
| `PORT` | READY | Default 3000. |
| `GSC_MOCK` | READY | Must be `"false"` in production (default `"true"` is dev-safe). |

## Frontend variables (build-time, public — never secrets)

| Variable | Status | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | REQUIRES CONFIGURATION | Must be `https://api.renkoo.online/api/v1` for this deployment. Default `http://localhost:3000/api/v1` (dev only). |
| `NEXT_PUBLIC_USE_REAL_PROVIDER` | REQUIRES CONFIGURATION | Must be `true` in production; default (unset/false) serves mock data. |

### Frontend production build

Build production ONLY via `npm run build:prod`, which runs
`scripts/validate-prod-env.mjs --production` first and fails closed:

`NEXT_PUBLIC_API_BASE=https://api.renkoo.online/api/v1`

`NEXT_PUBLIC_USE_REAL_PROVIDER=true`

The build fails if these requirements are not satisfied (missing provider
flag, non-`true` provider value, or a non-HTTPS / loopback / empty API base).
Plain `npm run build` stays dev-safe (mock + localhost allowed). The
validator inspects only these two public variables — never secrets.

## Database

- `prisma/schema.prisma` is the tracked source of truth. Run
  `npx prisma migrate deploy` on deploy (includes `FixApplyStatus.acknowledged`).
- `prisma/migrations/20260916163218_init` is CREATE-only (enums + tables +
  FK constraints, no drops) and is committed. Verified applied against the
  local Docker PostgreSQL (`_prisma_migrations` row present).

## Compose files

- `docker-compose.yml` — local development (dev literals, `GSC_MOCK=true`).
  Verified locally with `docker compose up -d --build`.
- `docker-compose.prod.yml` — production override, NO dev defaults. Every
  value is `${VAR:?required...}` and compose refuses to resolve without
  operator-supplied values (verified: fails closed). Deploy with:
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`
  plus a production `.env`/shell exports (never committed).

## Local Docker requirements

- Docker Desktop daemon running; `docker compose up -d --build` from
  repo root (needs a local `.env` — copy `.env.example`, never commit it).
- Health: `GET /api/v1/health` (liveness), `GET /api/v1/health/ready`
  (readiness reflects PostgreSQL; Redis reported `unknown` by design).
- Verified 2026-09-17: db/redis/api all `healthy`; readiness `db: ok`;
  Redis-backed sessions proven live (signup→me→logout→401, `sess:*` in Redis).
- Host-tooling note: a native PostgreSQL on this machine binds
  `0.0.0.0:5432`, so host-side Prisma/Jest must use the `5433:5432` alias
  (`DATABASE_URL=postgresql://renko:renko@127.0.0.1:5433/renko`).
- Queue durability (Prompt 5): the self-hosted `redis` service runs with AOF
  (`--appendonly yes` on the existing `redisdata` volume) so delayed BullMQ
  measurement jobs survive Redis restarts. For managed Redis, enable
  persistence/AOF there instead. Application code cannot guarantee Redis
  durability — the recovery guarantee is the bootstrap sweep: the database
  stays authoritative (`applied` + outcome-less + window elapsed ⇒ job is
  re-derived). Readiness (`/health/ready`) additionally reports
  `measurementQueue` provider state and the last sweep summary (zero-I/O,
  log-based observability otherwise).

## Google OAuth setup requirements

1. Cloud project with Search Console API enabled.
2. OAuth consent screen **In production** (avoids 7-day test-mode refresh expiry) with scopes `webmasters.readonly`, `openid`, `email` (least privilege; verified in code + e2e).
3. Authorized redirect URI exactly `GOOGLE_REDIRECT_URI`.
4. `GOOGLE_CLIENT_ID/SECRET` + 32-byte `GOOGLE_TOKEN_ENCRYPTION_KEY` set.

## Rate limits / proxy

- Global 60/min/IP; tighter per-route (`auth/*` 5–20/min, `properties/sync` 1/5m, `csrf` 30/min, GSC QPM bucket 1200/site).
- `trust proxy, 1` is set — terminate TLS at the proxy and forward
  `X-Forwarded-Proto` so `Secure` cookies work.

## Test commands

- Backend unit: `cd apps/api && npx jest --testPathIgnorePatterns "e2e"` (no DB needed).
- Backend e2e + full matrix: `cd apps/api && npx jest --runInBand` — requires
  PostgreSQL + env (`DATABASE_URL` pointing at the database; on this machine
  use the 5433 alias — see above). Verified 2026-09-17: 11 suites, 147/147 pass.
- Frontend: `npm test`, `npm run typecheck`, `npx next lint`, `npm run build`; run tests with both `NEXT_PUBLIC_USE_REAL_PROVIDER=false` and `=true`
  (verified 2026-09-17: 87/87 in both modes).

## Known limitations

- `docs/lifecycle-rules.md` (R1–R5, incl. acknowledged suppression).
- `docs/prompt-13-history-limitation.md` (history derivation, no separate table).
- Single-worker ingestion has no distributed lock (idempotent upserts + per-site QPM bucket instead); revisit for multi-worker scale.
- Dev-secret fallbacks exist but are **blocked in production by fail-fast boot checks**.
