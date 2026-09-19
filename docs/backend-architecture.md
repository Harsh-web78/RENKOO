# RENKO Backend Architecture — Report

**Version:** 1.0 — 2026-09-15
**Status:** Architecture proposal — awaiting approval before implementation
**Frontend commit inspected:** `renko-frontend` (Next.js 15, React 19) — `main` at report date
**Author:** OpenCode (Muse Spark) — architecture-only prompt; no backend code implemented

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Existing Frontend Architecture Discovered](#2-existing-frontend-architecture-discovered)
3. [Frontend / Backend Contract Map](#3-frontendbackend-contract-map)
4. [2026 Google API Research Findings](#4-2026-google-api-research-findings)
5. [OAuth Architecture](#5-oauth-architecture)
6. [Search Console Integration Architecture](#6-search-console-integration-architecture)
7. [Data Ingestion Architecture](#7-data-ingestion-architecture)
8. [Normalization Architecture](#8-normalization-architecture)
9. [Recommendation Engine Boundary](#9-recommendation-engine-boundary)
10. [Measurement Architecture](#10-measurement-architecture)
11. [PostgreSQL / Prisma Schema Proposal](#11-postgresqlprisma-schema-proposal)
12. [API Endpoint Proposal](#12-api-endpoint-proposal)
13. [Authentication / Session Strategy](#13-authenticationsession-strategy)
14. [Workspace / Property Authorization Model](#14-workspaceproperty-authorization-model)
15. [Redis / BullMQ Job Architecture](#15-redisbullmq-job-architecture)
16. [Error Handling Strategy](#16-error-handling-strategy)
17. [Freshness / Data-Quality Strategy](#17-freshnessdata-quality-strategy)
18. [Security Model](#18-security-model)
19. [Observability / Logging Strategy](#19-observabilitylogging-strategy)
20. [Docker / Deployment Architecture](#20-dockerdeployment-architecture)
21. [Testing Strategy](#21-testing-strategy)
22. [Migration Strategy From Current Mock Provider to Real Provider](#22-migration-strategy-from-current-mock-provider-to-real-provider)
23. [Risks and Unknowns](#23-risks-and-unknowns)
24. [Exact Implementation Order for the Next Prompts](#24-exact-implementation-order-for-the-next-prompts)
25. [Do Not Implement Yet](#25-do-not-implement-yet)
26. [Verification Results](#26-verification-results)
27. [Appendices](#27-appendices)

---

## 1. Executive Summary

RENKO's product promise is narrow by design: **one recommendation at a time, with evidence, measured honestly**. The existing frontend (`renko-frontend`) already encodes this promise in a disciplined data contract (`lib/data-contract/`). The backend's job is to **honor those contracts** while replacing an in-browser `localStorage` mock with a production NestJS + PostgreSQL + Redis/BullMQ system that talks to Google Search Console (GSC) through a provider interface.

**Core decision:** The frontend contracts are the source of truth. The backend normalizes Google's response shapes before any recommendation logic runs, and the recommendation engine never touches `googleapis` types. Every recommendation carries provenance (`SearchDataMeta`) with `dataThrough`, `retrievedAt`, `freshness`, `quality`, and `limitations`.

**Stack confirmed from tech direction:** NestJS (REST initially), PostgreSQL + Prisma, Redis + BullMQ, Google OAuth 2.0 (Authorization Code flow, `offline`), Google Search Console API (`searchanalytics.query` + `sites.list`/`sites.get`), Docker Compose, TypeScript. No additions until justified.

**Largest risks (summarized):** GSC siteUrl encoding (`sc-domain:` vs URL-prefix), anonymized-query data loss, load quotas, `refresh_token` single-return semantics, and the missing workspace isolation in the current contract — all addressed below with minimal compatible changes.

---

## 2. Existing Frontend Architecture Discovered

### 2.1 Project shape

- **Framework:** Next.js 15 App Router (`app/` route groups: `(marketing)`, `(auth)`, `(product)`, `onboarding`), React 19, Tailwind 3, TypeScript 5.6, ESLint `next/core-web-vitals`.
- **No backend:** All state is client-side via `lib/mock/session-context.tsx` persisted to `localStorage` key `renko-mock-session-v1`. `AppProviders` wraps `SessionProvider` in `app/layout.tsx:39-45`.
- **Pricing/config:** `lib/pricing-config.ts` (display prices per currency, no live billing) and `lib/site-config.ts` (`https://www.renkoo.online`).

### 2.2 Route inventory

| Group | Routes | Purpose |
|-------|--------|---------|
| `(marketing)` | `/`, `/pricing`, `/privacy`, `/terms`, `/contact` | Public SEO/marketing |
| `(auth)` | `/sign-up`, `/log-in` | Mock auth forms (`components/auth/*`) |
| `onboarding` | `/onboarding/create-workspace`, `/connect-search-console`, `/select-property`, `/analyzing`, `/first-fix` | Workspace → GSC connect → property pick → analysis → First Fix Reveal |
| `(product)` | `/home`, `/fixes`, `/history`, `/history/[fixId]`, `/settings` | Current fix, evidence drawer, outcome, history, settings |
| Root | `app/layout.tsx` | Document shell, no header/footer; each group owns chrome |

Guard logic: `components/onboarding/OnboardingGuard.tsx`, `lib/mock/onboarding.ts` (`resumeRoute`, `completedSteps`) drives redirect to nearest incomplete step.

### 2.3 Data contract — canonical source of truth

**Files:**

- `lib/data-contract/types.ts:1-189` — canonical types
- `lib/data-contract/provider.ts:1-27` — `SearchDataProvider` seam
- `lib/data-contract/mock-provider.ts:1-238` — deterministic mock impl
- `lib/data-contract/adapters.ts:1-104` — contract ↔ UI adapters
- `lib/data-contract/dates.ts:1-39`, `errors.ts:1-41`, `loading.ts:1-7`

**Layering (`types.ts:9-13`):**

```
DATA SOURCE → NORMALIZED SEARCH DATA → SIGNAL DETECTION → RECOMMENDATION → PRODUCT UI
```

External shapes (Google) never reach signal/recommendation logic.

**Key types (exact names, keep):**

- `SearchDataSource` (`google-search-console`), `SearchProperty` (`id`, `name`, `type: domain|url-prefix`), `SearchPeriod` (`start`, `end`, `label`, ISO inclusive), `SearchQueryRow` / `SearchPageRow` (numeric `ctr 0-1`, `position`), `EvidenceQueryRow` (display `ctr: "2.6%"`, `position: "4.1"`), `SearchDataMeta` (`source`, `property`, `period`, `dataThrough`, `retrievedAt`, `freshness`, `quality`, `limitations`), `SearchPerformanceSnapshot` (`meta`, `page`, `comparisonPage?`, `queries`), `SearchSignal` (`type: ctr-below-expected|position-decline|content-relevance-gap`), `Recommendation` (`id`, `page`, `signal`, `finding` (fact), `interpretation` (non-causal), `recommendedAction` (one), `rationale`, `snapshot`, `evidence`, `limitations`), `RecommendationResult` (`status: recommendation-available|no-signal|insufficient-data|stale-data|unavailable`, `recommendation?`, `meta?`), `SearchDataFreshness` (`fresh|delayed|stale|unavailable`), `SearchDataQuality` (`complete|partial|missing|delayed|conflicting|unavailable`), `SearchDataSourceId`.

**Provider seam (`provider.ts:15-27`):**

```ts
interface SearchDataProvider {
  getProperties(): Promise<Result<SearchProperty[], DataError>>;
  getPerformanceSnapshot(propertyId: string, period?: SearchPeriod): Promise<Result<SearchPerformanceSnapshot, DataError>>;
  getRecommendationResult(propertyId: string): Promise<RecommendationResult>;
}
```

`MockSearchDataProvider` implements it deterministically; `mockProviderSync` exposes sync core for `session-context` functional `setState` path (comment in `mock-provider.ts:232-236`).

**Mock property set (`mock-provider.ts:26-38`):** `example.com` (domain), `www.example.com` (url-prefix), `clientsite.com` (missing), `staleclient.com` (stale), `oldproject.com` (upstream error) — reused across `search-console-service.ts:57-76` with `PropertyStatus` mapping.

### 2.4 Mock services (all dev-only, documented as deletable not migratable)

- `lib/mock/auth-service.ts:41-98` — magic emails: `exists@`, `ratelimited@`, `offline@`, `notfound@`.
- `lib/mock/search-console-service.ts:40-78` — `connect(scenario)` with 900+700ms delays and `listProperties(scenario)`.
- `lib/mock/analysis-service.ts:52-89` — `runAnalysis(scenario, onStatusChange)` stepping `queued→connecting→loading-data→analyzing→ranking→complete|insufficient-data|no-opportunity|timeout|failed` with `STEP_DELAY_MS=1100` and `mockFixRecommendation`.
- `lib/mock/product-service.ts:11-215` — orchestration: `MEASUREMENT_WINDOW_DAYS=14`, `simulateOutcome` (hash-bucket deterministic), `fromOnboardingFix`, `seedSecondaryFix`, `seedHistory`, `seedPropertyState` (honest empties via `recommendationResultStatusToNoFixReason`).
- `lib/mock/onboarding.ts:3-62` — `emptyOnboardingState`, `onboardingSteps`, `resumeRoute`.

### 2.5 UI-facing product types (`lib/mock/types.ts:1-221`)

- `GoogleConnection` (`status` union of 11 values including `permission-denied`, `permission-insufficient`, `account-mismatch`, `expired`, `network-failure`, `server-failure` — beyond the simplified backend OAuth states).
- `SearchConsoleProperty` (`id`, `name`, `type: domain|url-prefix`, `status: healthy|needs-attention|stale|disconnected`, `selectable`).
- `AnalysisStatus` (10 values including `insufficient-data`, `no-opportunity`), `AnalysisJob`, `FixRecommendation`, `FixEvidence`, `OnboardingState`, `AuthState`, `FixStatus` (`available|reviewed|applied|dismissed`), `DismissReason` (5), `NoFixReason` (`no-fix|insufficient-data|stale-data|connection-error`), `FixBaseline`, `FixOutcomeMetrics`, `OutcomeStatus` (7: `positive-change|no-material-change|negative-change|insufficient-data|data-delayed|conflicting-data|unavailable`), `FixOutcome`, `ProductFix` (flattened UI shape carrying `dataMeta: SearchDataMeta`, `status`, `baseline`, `appliedAt`, `measurementWindowDays=14`, `expectedMeasurementDate`, `outcome?`), `HistoryItem`, `PropertyProductState` (`currentFix|null`, `history`, `noFixReason`, `lastCheckedAt`, `nextCheckAt`, `lastSuccessfulDataAt`), `ProductState` (`byProperty: Record<string, PropertyProductState>`).

### 2.6 UI states observed

- **Loading:** `lib/data-contract/loading.ts:7` (`initial-loading|refreshing|ready|error`) — contract exists but components currently read synchronously from `session-context`; real integration will need async loading skeletons.
- **Empty/honest outcomes:** `components/product/EmptyFixState.tsx:22-89` branches on `NoFixReason` into four distinct cards; `OutcomeCard.tsx:5-88` branches on 7 `OutcomeStatus` values with anti-causality copy ("not a guarantee the recommendation alone caused it").
- **Fix lifecycle:** `FixWorkspace.tsx:39-138` — `available→reviewed→applied (waiting)→measured (outcome)→acknowledged (null)` plus `dismissed` to history. `CurrentFixSummary.tsx:12-47` and `HomeContent.tsx:9-45` render same state; `HistoryContent.tsx` / `HistoryDetailContent.tsx` render `HistoryItem`.
- **Evidence:** `EvidenceDrawer.tsx:8-110` renders `dataMeta` provenance (source label, dataThrough, period label, retrievedAt), four metrics, query table, limitations.
- **Property isolation:** `ProductState.byProperty` keyed by `propertyId`; `lib/data-contract/tests/property-isolation.test.ts:1-87` asserts independent objects, unique fix ids/pages, seeded history scoped to `example.com`, onboarding fix only applies to `example.com`. This is the property-isolation invariant the backend must preserve with database constraints.
- **Dates:** `lib/data-contract/dates.ts:12-39` — `nowIso()` (ISO UTC), `addDays`, `daysAgoIso`, `formatDate` (en-US, UTC), `makeTrailingPeriod(28)` default ("Last 28 days vs. prior 28 days"). Frontend period is always trailing 28 vs prior 28; no custom ranges exposed yet.

### 2.7 Tests

- `lib/data-contract/tests/*.test.ts` (6 files) run via `npm test` → `node --experimental-strip-types --test lib/data-contract/tests/*.test.ts`. Coverage: property isolation, adapters, errors, dates, mock-provider, outcome determinism.

### 2.8 What the frontend does NOT yet have

- No workspace switcher beyond `onboarding.propertyId` as active pointer (`session-context.tsx:150-151`); `Workspace` type exists but only `workspaceName: string|null`.
- No backend polling/websocket for analysis; `analysis-service` is synchronous delay simulation.
- No real auth tokens/cookies; `User {id, email}` is mock.
- No pagination, no multi-property dashboard beyond per-property `byProperty`.

---

## 3. Frontend/Backend Contract Map

### 3.1 Contract preservation rule

`lib/data-contract/types.ts`, `errors.ts`, `dates.ts`, `loading.ts`, `provider.ts` are **frozen**. Backend implements `SearchDataProvider` server-side and exposes those shapes over REST. `Recommendation`'s `snapshot.meta` is the single source of provenance — do not duplicate `period`/`dataThrough`/etc elsewhere.

### 3.2 Mapping table

| Frontend contract | Backend responsibility | Notes / mismatch handling |
|-------------------|------------------------|---------------------------|
| `SearchProperty {id, name, type}` | Backend entity `SearchProperty` with `siteUrl` (raw GSC URL) + `displayName` + `type` | **Mismatch:** Frontend `id` is like `"example.com"` but GSC `siteUrl` is `sc-domain:example.com` or `https://www.example.com/`. Backend stores both: `siteUrl` (canonical, for API calls) and `frontendId`/`displayName`. API returns frontend `id` as opaque stable id; `siteUrl` never exposed to frontend. See §11. |
| `SearchPeriod {start,end,label}` | Backend computes trailing 28 vs prior 28; validates `start <= end`, 16-month window | Frontend only uses `makeTrailingPeriod(28)`. Backend must reject periods >16 months (`DataError INSUFFICIENT_DATA`). |
| `SearchQueryRow {query,clicks,impressions,ctr,position}` | Normalized from GSC `ApiDataRow {keys, clicks, impressions, ctr, position}` | Backend converts `ctr` string→number if needed (GSC already returns 0–1 double) and `position` double. |
| `EvidenceQueryRow {ctr: "2.6%"}` | Frontend formats via `formatCtr`; backend never formats | Keep backend numeric; adapter `toEvidenceRow` remains frontend concern. |
| `SearchDataMeta {source, property, period, dataThrough, retrievedAt, freshness, quality, limitations}` | Backend populates every field per snapshot | `dataThrough = period.end` for `fresh`, else `firstIncompleteDate - 1 day` or last available date. `freshness` derived from `dataState` metadata + age. `quality`/`limitations` derived from signal checks (see §17). |
| `SearchPerformanceSnapshot` | Backend returns one page + comparisonPage + top queries | Queries are top-N (e.g., 25) filtered to page; not exhaustive. Record `limitations` if truncated. |
| `SearchSignal` | Backend internal `SignalDetector` produces; not directly exposed today but implied by `Recommendation.signal` | Keep three types; no new signal without product approval. |
| `Recommendation {finding, interpretation, recommendedAction, rationale, evidence, snapshot}` | Backend `RecommendationEngine` produces; `finding` = observed fact, `interpretation` = may-indicate, never causal | Must never invent `confidence` score. Include `limitations` honestly. |
| `RecommendationResult {status, recommendation?, meta?}` | Backend endpoint `GET /properties/:id/recommendation` maps to this | `meta` present even when no recommendation (so UI explains freshness). `status` mapping from honest backend outcome (see §12). |
| `DataError {code, message}` | Backend maps Google/Prisma/BullMQ errors to these codes | `AUTH_REQUIRED`, `PERMISSION_DENIED`, `PROPERTY_NOT_FOUND`, `NO_DATA`, `INSUFFICIENT_DATA`, `STALE_DATA`, `PARTIAL_DATA`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `UNKNOWN_ERROR`. Messages user-safe, no stack. |
| `LoadingState` | Frontend will use for async fetches | Backend provides no loading; frontend manages. |
| `ProductFix`, `HistoryItem`, `FixOutcome`, `NoFixReason` | Backend entities `Fix`, `FixOutcome`, `HistoryEvent` map via adapters | `measurementWindowDays` backend constant `14` (matches `product-service.ts:23`). `OutcomeStatus` 7 values vs `RecommendationResultStatus` 5 — distinct phases (pre-measurement vs post-measurement). |
| `GoogleConnectionStatus` (11 values) | Backend exposes simpler `connectionStatus: connected|expired|revoked|needs_reauth|error` plus OAuth error code | Frontend's `permission-denied` etc are mock-specific; backend maps via §16. |
| `Workspace` (currently just `workspaceName`) | Backend `Workspace` with `id`, `name`, `ownerId`, `plan` | **Gap:** Frontend has no workspace id; backend introduces it compatibly (see §3.3). |
| `AnalysisStatus` (10 values) | Backend `IngestionJob` / `AnalysisJob` status | Mock `analyzing` steps are simulated delays; backend replaces with real GSC query stages (see §15). |

### 3.3 Smallest compatible changes (if backend requirement conflicts, propose here)

1. **Workspace identity:** Frontend stores `workspaceName: string|null` and no id. Backend requires `workspaceId: uuid`. Change: API returns `workspace: {id, name}`; frontend stores both (add `workspaceId` optional). Preserve `workspaceName` for back-compat. No breaking change to `OnboardingState` shape beyond additive field.
2. **Property id canonicalization:** Frontend ids are slugged domain names. Backend needs stable uuid + `siteUrl`. Change: `GET /properties` returns `SearchProperty {id: uuid, name, type}` where `id` is uuid but frontend can treat as opaque (already does in most places except mock's string literal checks). Migration note: `example.com` mock ids map to `sc-domain:example.com` in real data; frontend must not parse `id` as URL.
3. **Recommendation id:** Frontend uses `${propertyId}::fix-live`. Backend uses `uuid` (or `cuid`). Additive; no contract break because `Recommendation.id: string` already opaque.
4. **Period customization (future):** Frontend currently fixed 28 days. Backend supports arbitrary `period` param but defaults to trailing 28. No change needed now; add `?period=28d` query param later without breaking `getPerformanceSnapshot(propertyId, period?)`.
5. **DataError `RATE_LIMITED`:** Frontend handles it in tests but `MockSearchDataProvider` never returns it. Backend will. Frontend should add a toast/EmptyFixState? Already `EmptyFixState` has `connection-error` path; `RATE_LIMITED` maps to `DataErrorCode` correctly and UI shows retry/copy per §16.

No rename of `SearchDataMeta.freshness` / `quality` enums; backend must produce those exact strings.

---

## 4. 2026 Google API Research Findings

Research conducted 2026-09-15 via `websearch`/`webfetch` against `developers.google.com`, `googleapis.dev`, `support.google.com`, and current 2025-2026 changelogs. Official docs preferred; tutorials excluded.

### 4.1 OAuth 2.0 for web server applications

- **Sources:** `developers.google.com/identity/protocols/oauth2/web-server`, `.../oauth2` (refresh token expiration), `.../oauth2/web/guides/how-user-authz-works`, `.../web/guides/choose-authorization-model`, `.../oauth2/scopes`, `.../webmaster-tools/v1/how-tos/authorizing`.
- **Flow:** Authorization Code flow. Client redirects to `https://accounts.google.com/o/oauth2/v2/auth` with `access_type=offline`, `prompt=consent` (to force refresh_token on re-auth), `scope=https://www.googleapis.com/auth/webmasters.readonly`, `state=<csrf>`, `redirect_uri=<whitelisted>`. Google returns `code` to `redirect_uri`. Backend exchanges code at `https://oauth2.googleapis.com/token` for `{access_token, expires_in, refresh_token?, scope, token_type: Bearer, refresh_token_expires_in?}`. `refresh_token` **only on first authorization** unless `prompt=consent` (doc note in highlights). `access_type=offline` required for refresh token. Tokens must be stored secure, never exposed to frontend.
- **Scopes:** `webmasters.readonly` (read-only) and `webmasters` (read/write). RENKO needs **only `webmasters.readonly`** — least privilege. Scope is sensitive (requires consent screen verification if external user type). Do not request `webmasters` unless you need to add/delete sites (you don't; just read).
- **Refresh token expiration:** 6 months unused, user revoke (`shield_locked`), password change with Gmail scopes, 100 refresh tokens per account per client ID (oldest auto-invalidated), 7-day expiry for `publishing status = Testing` external projects (unless only `openid`/`userinfo` scopes). RENKO must set publishing status to `In production` before launch; include revocation monitoring via Cross-Account Protection (documented best practice).
- **State/CSRF:** Must generate cryptographically random `state`, store in httpOnly cookie or server session, validate on callback.

### 4.2 Search Console API — Sites

- **Endpoint:** `GET https://www.googleapis.com/webmasters/v3/sites` (list), `GET /sites/{siteUrl}` (get), `PUT /sites/{siteUrl}` (add), `DELETE /sites/{siteUrl}`. `siteUrl` path param must be URL-encoded. Domain properties use `sc-domain:example.com`; URL-prefix use `https://example.com/`.
- **Response:** `SitesListResponse { siteEntry: WmxSite[] }`, `WmxSite { siteUrl, permissionLevel }` with `permissionLevel ∈ {siteOwner, siteFullUser, siteRestrictedUser, siteUnverifiedUser}`. See `googleapis.dev/nodejs/.../searchconsole/interfaces/Schema$WmxSite.html` and `apis.io` schema. Only `siteOwner`/`siteFullUser` should be allowed to select property for analysis; `siteRestrictedUser` can read some data but may not see all; `siteUnverifiedUser` gets 403.
- **Auth:** Requires `webmasters.readonly` or `webmasters`.

### 4.3 Search Analytics — query

- **Endpoint:** `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` (or `searchconsole.googleapis.com` alias). Body `SearchAnalyticsQueryRequest`.
- **Required:** `startDate`, `endDate` (YYYY-MM-DD, PT — `UTC-7/8` / stated also as `UTC-8`/`PST`; Google docs say PST — treat as America/Los_Angeles). Must be `startDate <= endDate`, at least one day.
- **Optional:** `dimensions: string[]` (order matters, grouping keys), `dimensionFilterGroups`, `aggregationType: auto|byPage|byProperty|byNewsShowcasePanel`, `rowLimit: 1–25,000 (default 1,000)`, `startRow: 0+`, `searchType: web|image|video|news|discover|googleNews` (aka `type` in older docs), `dataState: final|all|hourly_all` (see §4.7), `type` alias for `searchType`.
- **Dimensions (current docs):** `query`, `page`, `country` (ISO 3166-1 alpha-3, e.g., `usa` not `US`), `device` (`DESKTOP|MOBILE|TABLET`), `searchAppearance`, `date`, `hour` (introduced 2025-04-09 for hourly).
- **Filters:** `dimensionFilterGroups[].filters[] {dimension, operator, expression}` with `operator ∈ {equals, contains, notContains, notEquals, includingRegex, excludingRegex}` (RE2). `groupType` AND/OR within group; groups ANDed together. Max like 4096 chars.
- **Response:** `SearchAnalyticsQueryResponse { responseAggregationType, rows: ApiDataRow[] { keys, clicks, impressions, ctr (0-1 double), position (double) } }`. Sorted by clicks desc (or date asc if grouping by date). May omit days without data when grouping by date.
- **Data limits:** Internal limitations — does not guarantee all rows, only top ones. Explicit limit: **50K rows per day per search type** (sorted by clicks) beyond API QPM. `rowLimit 25K` per request; paginate via `startRow`. Docs: `developers.google.com/webmaster-tools/v1/how-tos/all-your-data` ("Data limits") and `.../limits`.

### 4.4 Available metrics & aggregation

- **Metrics:** `clicks`, `impressions`, `ctr` (= clicks/impressions, 0–1), `position` (average, lower is better). Docs in `.../webmaster-tools/v1/searchanalytics/query` table.
- **Aggregation:** `aggregationType`. If grouping/filtering by `page`, must be `auto` or `byPage`; `byProperty` disallowed. If grouping by `page`/`query`, some data is dropped to allow timely computation (disclosed on `all-your-data` page: "When you group by page and/or query, our system may drop some data..."). Two-step process for `searchAppearance` alone then filter.
- **Anonymized queries:** Rare queries withheld for privacy (like Interface). Clicks/impressions totals from query rows won't sum to property totals; disclosed and must be reflected in `limitations`.

### 4.5 Row limits, date range limitations, data retention

- **Per-request rowLimit:** 1–25,000, default 1,000 (must set explicitly to 25K).
- **Per-day per-type:** 50K rows max per day per search type (API-enforced top-N by clicks).
- **Historical data:** 16 months retention (`metaflow.life` guide, Google docs). Older data not available — backend must validate and return `DataError INSUFFICIENT_DATA` if period starts before ~16 months ago.
- **Date alignment:** Dates in PT/PST (America/Los_Angeles). Use UTC storage but convert period boundaries to PT for GSC calls. One-day window recommended for daily pulls to avoid quota (see §7).

### 4.6 Quotas

- **Source:** `developers.google.com/webmaster-tools/limits` (2024-01-25) + 2026 blog confirmations (`analyseo.app`, `metaflow.life`).
- **Search Analytics:** **1,200 QPM per site (same siteUrl)**, **1,200 QPM per user**, **30,000,000 QPD per project**, **40,000 QPM per project**. Plus **load quotas** (short-term 10-min, long-term 1-day) measured in internal resources — exceeding yields `quotaExceeded` same as QPS limits. Single query inside 10-min that still exceeds => long-term load.
- **Sites/Sitemaps (other resources):** 20 QPS / 200 QPM per user, 100M QPD per project.
- **URL Inspection:** 2,000 QPD / 600 QPM per site, etc — not used by RENKO v1 but rate limits matter if added later.
- **Practical:** For RENKO with ~14-day trailing windows and 3–4 GSC calls per property per day, quota is generous. Risk only at scale (>1k workspaces polling concurrently without batching/jitter).

### 4.7 Data latency & dataState

- **Latency:** Standard 2–3 days (`support.google.com/webmasters/answer/96568` — "Normally data should be available in 2-3 days") and up to a week for newly added properties. Performance report tracks by California time; mismatches with UTC/local systems expected.
- **Fresh/partial data (2025-2026 additions):**
  - `dataState: "final"` (default) — only finalized data.
  - `dataState: "all"` — includes still-collecting/partial data for recent dates; response may include `metadata.firstIncompleteDate` (YYYY-MM-DD) when grouping by `date`.
  - `dataState: "hourly_all"` with `dimension: "hour"` — hourly breakdown up to 10 days (`searchengineland.com` 2025-04-09), `metadata.firstIncompleteHour` (ISO-8601 offset datetime) marks incomplete window; "All values after may still change noticeably."
  - Applies only when `dataState` is `all`/`hourly_all` **and** grouping by `DATE`/`HOUR`; docs added 2025-07-14 changelogs. Backend should expose `dataThrough` and `freshness` based on this metadata (see §17).
- **Hourly:** Only last 10 days, requires `HOUR` dimension + `hourly_all`. Not needed for RENKO v1 28-day windows; keep `dataState=final` for recommendations, optionally use `all` for freshness warning.

### 4.8 Verified properties & permission levels

- **Types:** `domain` (`sc-domain:example.com`, DNS verification, covers all subdomains/protocols) vs `url-prefix` (`https://www.example.com/`, multiple verification methods). Docs `support.google.com/webmasters/answer/34592`.
- **Permission levels:** `siteOwner` (verified or delegated, full control), `siteFullUser`, `siteRestrictedUser`, `siteUnverifiedUser`. See `support.google.com/webmasters/answer/2453966`. Non-owners capped at 100 per property; owners up to 500 delegated + unlimited verified. Backend should gate analysis on `siteOwner` or `siteFullUser`; `siteRestrictedUser` may lack some data.

### 4.9 OAuth scopes required

- **RENKO needs:** `https://www.googleapis.com/auth/webmasters.readonly` only. Do not request `webmasters` (write) or `indexing` (different host). Verified against `.../how-tos/authorizing` and `apis.io/scopes`.

### 4.10 Refresh-token handling

- `access_type=offline` + `prompt=consent` on initial and re-auth.
- Google returns `refresh_token` only once; store immediately encrypted.
- Refresh via `POST oauth2.googleapis.com/token` with `grant_type=refresh_token`. Access token ~1h (`expires_in`).
- On `invalid_grant` (revoked/expired), mark connection `expired` and surface to frontend for re-connect.
- Observe 100-token cap and 6-month unused expiry.

### 4.11 Google API errors

- **Auth:** 401 Unauthorized (invalid/expired token), 403 Forbidden (permissionLevel insufficient, unverified user, scope mismatch, quota).
- **Data:** 400 INVALID_ARGUMENT (bad `siteUrl`, dates, aggregationType), 404 NOT_FOUND (property not found), 429 quotaExceeded (with `Retry-After` guidance — though GSC uses QPM counters, handle 429 generically), 500/503 internal.
- **Payload:** Standard `error: {code, message, status, errors: [{message, domain, reason}]}`. `reason=quotaExceeded` appears for both QPS and load.
- **Discovery:** Sites `404` vs Search Analytics `403` for no-access — backend must distinguish and map to `PERMISSION_DENIED` vs `PROPERTY_NOT_FOUND`.

### 4.12 Data-quality limitations relevant to RENKO

- **Top-rows only:** API does not guarantee all rows; pagination up to 50K/day/type but sorted by clicks, long-tail truncated. Must disclose in `limitations` ("Only the top N queries were returned").
- **Anonymized queries:** Rare queries suppressed; totals don't sum. Disclose.
- **Page/query grouping costs:** Grouping by `page`/`query` drops some data for timely calc — prefer `byPage` but document tradeoff.
- **Search appearance two-step:** Can't group `searchAppearance` with others — needs separate queries if ever needed (not v1).
- **16-month window:** Must enforce server-side.
- **Delay/staleness:** 2–3 day delay means `dataThrough` trails `now` by days — backend must not claim `fresh` when `dataThrough` old.
- **Incomplete metadata:** `firstIncompleteDate` handling required for freshness honesty.

---

## 5. OAuth Architecture

### 5.1 Flow — Authorization Code with offline access

```
[Browser] --click Connect--> [NestJS GET /auth/google/start]
                                   |  state=random(32B) -> set httpOnly cookie `oauth_state` (SameSite=Lax, Secure, 10m TTL)
                                   |  redirect 302 to https://accounts.google.com/o/oauth2/v2/auth?
                                   |    client_id, redirect_uri, scope=webmasters.readonly,
                                   |    response_type=code, access_type=offline, prompt=consent,
                                   |    include_granted_scopes=true, state
[Google consent] --code+state--> [NestJS GET /auth/google/callback?code&state]
                                   |  validate state vs cookie (constant-time), clear cookie
                                   |  POST https://oauth2.googleapis.com/token {code, client_id, client_secret, redirect_uri, grant_type=authorization_code}
                                   |  -> {access_token, refresh_token?, expires_in, scope}
                                   |  fetch https://www.googleapis.com/oauth2/v2/userinfo? (for google email) OR decode id_token if using openid scope addition — but RENKO uses only webmasters.readonly, so call userinfo with access_token to get email (requires extra scope? Instead use people? Alternative: don't fetch email, just use Search Console sites.list to confirm access. For account-mismatch detection, need Google account email.)
                                   |  upsert SearchConsoleConnection {workspaceId, userId, encrypted tokens, googleAccountEmail, scopes, tokenExpiry}
                                   |  redirect to frontend `/onboarding/connect-search-console?status=connected` (or error query)
[Frontend] polls `GET /connections/status` or reads redirect param
```

**Decision: scope for email.** `webmasters.readonly` alone does not give email. Options: (a) add `openid email` scope to get `id_token` with email claim (minimal extra scope, requires consent-screen verification but openid scopes are less sensitive and testing note says 7-day refresh exception excludes openid scopes — safe). **Recommended:** request `openid email https://www.googleapis.com/auth/webmasters.readonly` together on same consent. This matches `mockSearchConsoleService` scenarios needing `account-mismatch` detection. Document in consent disclosure.

Alternative if strictly one scope: call `GET https://www.googleapis.com/webmasters/v3/sites` and infer authorized property access without email; mismatch shown as generic 403 — worse UX. So include `openid email`.

### 5.2 Token storage

- **Encryption at rest:** AES-256-GCM with per-row or per-workspace key? Proposal: app-level `ENCRYPTION_KEY` (32-byte base64) via env; NestJS `TokenEncryptionService` does `encrypt(plaintext) -> base64(nonce|ciphertext|tag)`, `decrypt`. Keys via `GOOGLE_TOKEN_ENCRYPTION_KEY` env. Future rotate via `keyVersion` column.
- **Columns:** `SearchConsoleConnection.encryptedAccessToken`, `encryptedRefreshToken` (text), `accessTokenExpiresAt`, `refreshTokenExpiresAt?`, `tokenVersion`.
- **Never log tokens.** Prisma `select: { encryptedAccessToken: false }` by default; service selects only when needed.

### 5.3 Refresh

- **Lazy refresh:** Before any GSC call, `GoogleAuthService.refreshIfNeeded(connection)` checks `accessTokenExpiresAt < now + 60s`. If needed, `POST token endpoint` with `refresh_token`. On success, update encrypted tokens + `accessTokenExpiresAt = now + expires_in`. On `invalid_grant`, mark `status=expired`, emit audit log, return `DataError AUTH_REQUIRED` to caller.
- **Proactive:** BullMQ job `TokenRefreshJob` runs every ~50m to refresh near-expiry tokens for active workspaces (optional optimization; lazy is sufficient for v1).
- **Revocation:** `GET /auth/google/revoke` → `POST https://oauth2.googleapis.com/revoke` with refresh_token, delete connection.

### 5.4 Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET /auth/google/start` | Session (user) | Initiate OAuth |
| `GET /auth/google/callback` | Query `code, state` | Exchange, persist, redirect |
| `POST /auth/google/revoke` | Workspace auth | Revoke + disconnect |
| `GET /connections/status` | Workspace auth | Frontend polls `GoogleConnection` simplified |

### 5.5 Security controls

- `state` random 32B (`crypto.randomBytes`) base64url, httpOnly `oauth_state` cookie with `Max-Age=600`, `Secure`, `SameSite=Lax`, `Path=/auth/google`.
- `redirect_uri` exact match whitelisted (`GOOGLE_REDIRECT_URI` env).
- CSRF for start: if using cookie session, also validate `csrfState` double-submit? With SameSite Lax and state cookie, sufficient; add NestJS `CsrfGuard` for other POSTs.
- Rate limit `/auth/google/start` (5/min/IP) to prevent consent spam.
- No tokens in URLs, cookies, or frontend responses. Only `status` + `googleAccountEmail`.

---

## 6. Search Console Integration Architecture

### 6.1 Provider interface — server-side

Port frontend's `SearchDataProvider` to backend NestJS provider behind workspace isolation:

```ts
// apps/api/src/search-console/search-console.provider.ts
interface SearchConsoleProvider {
  listProperties(params: { workspaceId: string; userId: string }): Promise<Result<SearchProperty[], DataError>>;
  queryPerformance(params: {
    workspaceId: string;
    siteUrl: string; // canonical, not frontend id
    period: SearchPeriod; // validated 16-month, PT-aligned
    dimensions?: string[];
    rowLimit?: number;
    searchType?: string;
    aggregationType?: string;
    dataState?: 'final' | 'all';
  }): Promise<Result<SearchAnalyticsResponse, DataError>>;
}
```

Two implementations:
- `GscSearchConsoleProvider` — real Google API via `googleapis` npm (`google.searchconsole('v1')`) or raw `fetch` with refreshed `access_token` Bearer.
- `InMemoryMockProvider` — mirrors current `MockSearchDataProvider` for tests/CI without credentials (keeps `lib/data-contract/tests` green).

**DI token:** `'SEARCH_CONSOLE_PROVIDER'` → factory picks based on `GSC_MOCK=true` env.

### 6.2 Client details

- Use `googleapis` npm + `GoogleAuth` with custom `credentials: { access_token }` per-request, not service-account. Simpler: direct `fetch` to `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query` with `Authorization: Bearer ${accessToken}`. Avoids `googleapis` heavy dependency and aligns with token-refresh control. **Proposed:** `fetch` + `zod` validation of response.
- Timeout 15s, retry 3x with exponential backoff on 429/500/503, jitter.
- Validate `siteUrl` format before call: regex `^sc-domain:.+$` or `^https?://.+/` (must end with `/` for URL-prefix per docs).

### 6.3 Sites

- `GET /sites` (list) maps to `SitesListResponse`; filter to caller's permission levels ≥ `siteFullUser` for selectable property. Keep `siteUrl` internal.
- `GET /sites/{siteUrl}` used for authorization check before any `searchAnalytics/query` (defense in depth — though GSC would 403 anyway, faster to give `PROPERTY_NOT_FOUND` vs `PERMISSION_DENIED`).

### 6.4 Search Analytics queries for RENKO

RENKO needs at least 4 GSC calls per recommendation (per property, per run):

1. **Latest-page query:** `dimensions: ["page"]`, period = trailing 28d, `rowLimit: 50`, `aggregationType: byPage` → find candidate pages with impressions but CTR/position anomalies.
2. **Prior-page query:** same but prior 28d (`period` shifted by 28d) for comparison (`comparisonPage`).
3. **Query-level for candidate page:** `dimensions: ["query"]`, `dimensionFilterGroups: [{filters: [{dimension:"page", operator: "equals", expression: candidatePage }]}]`? But GSC page filter requires full URL (`https://example.com/pricing`) not path `/pricing`. Need to map path ↔ full URL. See §11 `pageUrl` handling.
4. **Fallback date-availability probe:** optional `dimensions: ["date"]` with `dataState: final` to learn `dataThrough` if recent data empty; or rely on `metadata.firstIncompleteDate`.

Decision: **Normalize page to full URL internally** but expose path to frontend (existing contract uses path). Store `siteOrigin` per property.

Alternative simpler for v1: **page-agnostic query** `dimensions: ["page","query"]` top 100, then aggregate per-page in normalization — fewer round-trips, at cost of 50K row handling. For low-traffic properties, single call suffices.

**Default:** single call per period `dimensions: ["page","query"]`, `rowLimit: 25000`, paginated if 25K returned; then derive per-page snapshot in normalization. This honors API docs "get more than 25K rows" pagination.

---

## 7. Data Ingestion Architecture

### 7.1 Snapshot model

Do not query GSC on every frontend `GET /recommendation`. Instead, ingest and cache normalized snapshots so recommendation is computed against stable, validated data and GSC load quotas are respected.

**Flow:**

```
Trigger (manual / scheduled / onboarding) → BullMQ job `IngestSearchData` {workspaceId, propertyId, period}
  → load SearchConsoleConnection (decrypt, refresh token)
  → validate property belongs to workspace (DB FK)
  → call SearchConsoleProvider.queryPerformance (period, periodPrior, maybe pagination)
  → normalize (see §8) → validate via zod → compute SearchDataMeta (freshness/quality)
  → upsert SearchDataSnapshot {workspaceId, propertyId, periodStart, periodEnd, dataThrough, retrievedAt, rawResponseHash, normalizedJson, freshness, quality, limitations}
  → emit event `snapshot.ingested` → BullMQ job `DetectRecommendation`
```

**Idempotency:** `(workspaceId, propertyId, periodStart, periodEnd)` unique index; `rawResponseHash` (sha256 of canonical JSON) dedupes re-ingests. Retries safe.

### 7.2 Periods

- Default: trailing 28 days (`makeTrailingPeriod(28)`) vs prior 28. Backend stores both windows as two snapshots or one snapshot with embedded `comparisonPage`. Proposal: **one snapshot per current period** containing both `page` and `comparisonPage` values (matches `SearchPerformanceSnapshot` shape). Fetch prior period as separate GSC call but normalize into same `SearchPerformanceSnapshot`.
- PT alignment: convert `SearchPeriod.start/end` from ISO UTC midnight to `YYYY-MM-DD` in America/Los_Angeles for GSC query. Store period as ISO UTC in DB; convert at provider boundary.

### 7.3 Scheduling

- **On demand:** `POST /properties/:id/ingest` (auth, rate-limited 1/5m per property) for frontend "Refresh data" / "Try again".
- **Scheduled:** BullMQ repeatable job `DailyIngest` cron `0 4 * * *` (after PT midnight, when GSC finalizes previous day around 2–3 days delay). Each active property gets an ingestion job (stagger with jitter 0–60m). Only properties with `status=healthy|needs-attention` scheduled.
- **Onboarding:** `onAnalysisRequested` → immediate ingest job with high priority.

### 7.4 Data retention

- Raw `normalizedJson` retained 90 days then pruned to save PG `jsonb` size; `SearchPerformanceSnapshot` provenance kept in `Recommendation.snapshot` denormalized copy for history.
- 16-month GSC retention is external; backend does not need to store 16 months but will enforce period validation before calling GSC.

---

## 8. Normalization Architecture

### 8.1 Purpose

Google's shapes (`ApiDataRow.keys[]`, double `clicks` actually integer, `position` double, `ctr` double) must not leak into recommendation logic. Normalization is the place to fail honestly (quality/freshness) rather than letting weird data produce a confident recommendation.

### 8.2 Steps

1. **Validate raw:** zod schema for `SearchAnalyticsQueryResponse`; assert `rows` present, `keys` length matches `dimensions`.
2. **Map rows:** `keys[0]` (if `dimensions: ["page","query"]`) → `pageUrl`, `keys[1]` → `query`. Extract `clicks` (round to int), `impressions` (int), `ctr` (clamp 0–1), `position` (clamp 1+). Drop rows with impossible values (ctr >1, negative clicks) and add limitation.
3. **Anomaly suppression handling:** If `totalClicks` from `rows` aggregated ≠ `byProperty` total (if fetched), set `quality=partial`, limitation "Some search activity is withheld for privacy — totals won't reconcile with query breakdowns."
4. **Aggregate per-page:** Group by `pageUrl` → compute `SearchPageRow {page: path, clicks, impressions, ctr, position}` weighted by impressions (ctr = totalClicks/totalImpressions, position = weighted avg by impressions). Keep top page by `impressions` desc with `ctr-below-expected` candidate logic pre-normalization? Actually normalization should be dumb; signal detection decides which page.
5. **Top queries per page:** For candidate page (`max impressions`), filter rows where `pageUrl==candidate`, sort by `clicks` desc, take top 10 (`rowLimit` 25 for evidence drawer). Map to `SearchQueryRow` (numeric ctr) + also compute `EvidenceQueryRow` formatted via `formatCtr` if needed (but keep numeric in DB — format in adapter later).
6. **Period mapping:** Derive `SearchPeriod` label (caller provided) and keep start/end ISO.
7. **DataThrough:** `period.end` if `dataState=final` and `retrievedAt` within 3 days of period end; else `firstIncompleteDate -1d` or `period.end` minus gap detected from `date`-grouped probe.
8. **Limitations:** Collect: `"Only the top 25 queries were returned"`, `"Some data withheld for privacy"`, `"Page/query grouping may omit low-volume data"`.

### 8.3 Module

`src/normalization/search-data.normalizer.ts` — pure function `normalizeSearchAnalyticsResponse(raw, params): Result<SearchPerformanceSnapshot, DataError>`. No DB, no Google SDK import in return type. Unit-tested with fixture JSONs (recorded GSC responses plus anonymized edge cases).

### 8.4 Validation

`src/normalization/dto/search-performance-snapshot.dto.ts` — `zod`/`class-validator` for `SearchDataMeta`, `SearchPageRow`, etc. `ctr` must be `0<=ctr<=1`, `position >=1`, `impressions >=0`.

---

## 9. Recommendation Engine Boundary

### 9.1 Rules

- Must not import `googleapis` or `SearchAnalyticsQueryResponse`.
- Input: `SearchPerformanceSnapshot` (validated, normalized). Output: `RecommendationResult`.
- No fabricated SEO scores, no confidence percentage, no causal claims. Strings: `finding` (observed fact), `interpretation` (may-indicate, hedged), `recommendedAction` (one concrete action), `rationale` (ties evidence to recommendation in one sentence).
- Deterministic, testable without live GSC — all logic pure functions.

### 9.2 Signals (current three, keep)

- `ctr-below-expected`: `page.impressions` substantial (>~500) but `page.ctr` below expected for `page.position` (e.g., <75th percentile of ctr-by-position curve or vs `comparisonPage.ctr`). Use `comparisonPage` delta when available: ctr decline >20% while impressions stable (±10%).
- `position-decline`: `page.position` worsened by ≥X (e.g., +1.0 or +1.5) vs `comparisonPage.position` while impressions steady — indicates relevance gap not demand drop.
- `content-relevance-gap`: `queries` show mismatch — top query intent not served by page (heuristic: top query impressions high, query-page ctr low, or position held but clicks dropped). For v1, reuse `ctr-below-expected` interpretation; third type reserved for future content heuristic.

Engine picks **at most one** recommendation per property, ordered by evidence strength (largest impression volume * ctr gap). If no signal passes thresholds, return `status: no-signal` with `meta`.

### 9.3 Output

```ts
interface RecommendationEngine {
  evaluate(snapshot: SearchPerformanceSnapshot): RecommendationResult;
}
```

`evaluate` never throws for normal "no signal"; returns honest empty statuses (`insufficient-data`, `stale-data`, `unavailable` are set upstream in ingestion based on `freshness`/`quality`, not here). Engine only returns `recommendation-available` or `no-signal`.

### 9.4 Evolution

Signal thresholds live in `src/recommendation/signal-config.ts` (constants, env-overridable). No ML in v1. Future improvements add per-vertical baselines without changing `Recommendation` shape.

---

## 10. Measurement Architecture

### 10.1 Fix lifecycle (mirrors `types.ts:118-221`)

```
available → reviewed → applied (baseline captured) → measured (outcome) → acknowledged (null) → no-fix
                 ↘ dismissed → history
```

Backend entities:

- `Fix` (`id uuid, workspaceId, propertyId, recommendationId, page, status: available|reviewed|applied|dismissed, baseline {clicks,ctr,position,capturedAt}, appliedAt, expectedMeasurementDate = appliedAt+14d, outcomeId?`)
- `Recommendation` (denormalized snapshot copy + finding/interpretation/rationale; FK to Fix)
- `FixOutcome` (`id, fixId, status: OutcomeStatus 7 values, before {clicks,ctr,position}, after? {clicks,ctr,position}, measuredAt?, createdAt`)
- `HistoryItem` derived from `Fix` query (`status applied/dismissed`, ordered desc).

### 10.2 Baseline

On `POST /fixes/:id/apply`, backend snapshots current `SearchPerformanceSnapshot` metrics into `Fix.baseline` (clicks, ctr, position) atomically. `expectedMeasurementDate = addDays(appliedAt, 14)` — matches frontend `MEASUREMENT_WINDOW_DAYS`.

### 10.3 Outcome evaluation

`POST /fixes/:id/check` (or scheduled job at `expectedMeasurementDate`) → ingest fresh snapshot for post-apply window vs baseline period → compare:

- Fetch `currentSnapshot` for same `page` over last 14d (or 28d? spec says 14d window). Compute `before` from `baseline`, `after` from current snapshot page metrics.
- Classify `OutcomeStatus`:
  - `positive-change`: clicks +≥10% or position improvement ≥0.7 and ctr improvement.
  - `negative-change`: opposite.
  - `no-material-change`: within band.
  - `insufficient-data`: `quality=missing` or low impressions.
  - `data-delayed`: `freshness=delayed/stale`.
  - `conflicting-data`: clicks up but position down, etc.
  - `unavailable`: GSC error.
- Copy must be non-causal: "observed during comparison window, not a guarantee the recommendation alone caused it" (UI copy already in `OutcomeCard.tsx:83-84`).

### 10.4 Frontend wiring

- `FixWorkspace.tsx` "Check for results now" is mock bypass; real backend enforces window — early `check` returns `data-delayed` if before `expectedMeasurementDate` unless `?force=true` for preview (but production should still return `data-delayed` with message).
- `OutcomeCard.tsx` already renders all 7 statuses with correct copy — no change.

---

## 11. PostgreSQL / Prisma Schema Proposal

### 11.1 Minimal correct schema (no speculative tables — only what contracts require)

```prisma
// prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum PropertyType { domain url_prefix }
enum PropertyStatus { healthy needs_attention stale disconnected }
enum GscPermissionLevel { siteOwner siteFullUser siteRestrictedUser siteUnverifiedUser }
enum ConnectionStatus { connected expired revoked needs_reauth error }
enum Freshness { fresh delayed stale unavailable }
enum Quality { complete partial missing delayed conflicting unavailable }
enum RecommendationStatus { recommendation_available no_signal insufficient_data stale_data unavailable }
enum SignalType { ctr_below_expected position_decline content_relevance_gap }
enum FixApplyStatus { available reviewed applied dismissed }
enum OutcomeStatus { positive_change no_material_change negative_change insufficient_data data_delayed conflicting_data unavailable }

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String?  // bcrypt for email/password auth; nullable until OAuth-only path
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  workspaces   WorkspaceMember[]
  googleTokens SearchConsoleConnection[] // per-workspace connections
}

model Workspace {
  id        String   @id @default(cuid())
  name      String
  plan      String   @default("solo") // solo|agency; gated by property count
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  members   WorkspaceMember[]
  properties SearchProperty[]
  connections SearchConsoleConnection[]
  fixes     Fix[]
  snapshots SearchDataSnapshot[]
  jobs      IngestionJob[]
}

model WorkspaceMember {
  userId      String
  workspaceId String
  role        String   @default("owner") // owner|member
  createdAt   DateTime @default(now())
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@id([userId, workspaceId])
  @@index([workspaceId])
}

model SearchConsoleConnection {
  id                    String           @id @default(cuid())
  workspaceId           String
  userId                String
  googleAccountEmail    String?
  encryptedAccessToken  String           // base64 nonce|ciphertext
  encryptedRefreshToken String
  accessTokenExpiresAt  DateTime
  refreshTokenExpiresAt DateTime?
  scopes                String[]         // e.g. ["https://.../auth/webmasters.readonly", "openid", "email"]
  status                ConnectionStatus @default(connected)
  keyVersion            Int              @default(1)
  lastRefreshedAt       DateTime         @default(now())
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt
  workspace             Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([workspaceId]) // one connection per workspace (single Google account per workspace v1)
  @@index([userId])
}

model SearchProperty {
  id              String            @id @default(cuid())
  workspaceId     String
  siteUrl         String            // canonical GSC: sc-domain:example.com or https://www.example.com/
  displayName     String            // human label, e.g. example.com
  type            PropertyType
  permissionLevel GscPermissionLevel?
  status          PropertyStatus    @default(healthy)
  isSelectable    Boolean           @default(true)
  siteOrigin      String            // https://www.example.com for pageUrl construction
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  snapshots       SearchDataSnapshot[]
  recommendations Recommendation[]
  fixes           Fix[]
  @@unique([workspaceId, siteUrl]) // property isolation: no cross-workspace leak
  @@index([workspaceId])
}

model SearchDataSnapshot {
  id              String   @id @default(cuid())
  workspaceId     String
  propertyId      String
  siteUrl         String   // denormalized for quick lookup
  periodStart     DateTime // inclusive UTC
  periodEnd       DateTime // inclusive UTC
  periodLabel     String
  dataThrough     DateTime
  retrievedAt     DateTime @default(now())
  freshness       Freshness
  quality         Quality
  limitations     String[] // human caveats
  normalizedJson  Json     // SearchPerformanceSnapshot (validated)
  rawResponseHash String   // sha256 of canonical raw
  rowCount        Int
  createdAt       DateTime @default(now())
  workspace       Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  property        SearchProperty @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  @@unique([propertyId, periodStart, periodEnd, rawResponseHash]) // idempotent
  @@index([workspaceId, propertyId, periodEnd])
}

model Recommendation {
  id                String               @id @default(cuid())
  workspaceId       String
  propertyId        String
  snapshotId        String?              // FK to snapshot that produced it
  signal            SignalType
  page              String               // "/" or "/pricing" (path)
  pageUrl           String               // https://www.example.com/pricing (for GSC filter)
  finding           String
  interpretation    String
  recommendedAction String
  rationale         String
  evidenceJson      Json                 // RecommendationEvidence {rows: EvidenceQueryRow[]}
  snapshotJson      Json                 // SearchPerformanceSnapshot denormalized copy (provenance)
  limitations       String[]
  status            RecommendationStatus @default(recommendation_available)
  createdAt         DateTime             @default(now())
  workspace         Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  property          SearchProperty @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  @@index([workspaceId, propertyId, createdAt])
}

model Fix {
  id                        String         @id @default(cuid())
  workspaceId               String
  propertyId                String
  recommendationId          String?
  page                      String
  status                    FixApplyStatus @default(available)
  dismissReason             String?        // already_fixed|not_applicable|...
  baselineClicks            Int?
  baselineCtr               String?        // formatted like "2.6%" for UI back-compat; numeric ctr also in snapshot
  baselinePosition          Float?
  baselineCapturedAt        DateTime?
  appliedAt                 DateTime?
  expectedMeasurementDate   DateTime?
  measurementWindowDays     Int            @default(14)
  outcomeId                 String?        @unique
  createdAt                 DateTime       @default(now())
  updatedAt                 DateTime       @updatedAt
  workspace                 Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  property                  SearchProperty @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  outcome                   FixOutcome? @relation(fields: [outcomeId], references: [id])
  @@index([workspaceId, propertyId, status])
}

model FixOutcome {
  id         String        @id @default(cuid())
  fixId      String        @unique
  status     OutcomeStatus
  beforeJson Json          // FixOutcomeMetrics
  afterJson  Json?         // FixOutcomeMetrics | null
  measuredAt DateTime?     @default(now())
  createdAt  DateTime      @default(now())
  fix        Fix           @relation(fields: [fixId], references: [id], onDelete: Cascade)
}

model IngestionJob {
  id          String   @id @default(cuid())
  workspaceId String
  propertyId  String
  siteUrl     String
  periodStart DateTime
  periodEnd   DateTime
  status      String   @default("queued") // queued|running|completed|failed
  attempts    Int      @default(0)
  lastError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@index([workspaceId, propertyId, status])
  @@index([status, createdAt])
}
```

**Indexes & constraints enforcing isolation:**

- Every table with `workspaceId` has FK + composite unique `[workspaceId, siteUrl]` on `SearchProperty`, preventing cross-workspace assignment.
- Row-level security (optional Postgres RLS) on `SearchProperty` / `SearchDataSnapshot` / `Fix` — enable `workspaceId = current_setting('app.workspace_id')` fallback; primary isolation is app-layer `WHERE workspaceId = :callerWorkspaceId` via Prisma middleware + NestJS guard.
- `SearchDataSnapshot.normalizedJson` uses `jsonb` with GIN index if querying by page later (v1 not needed).

**Why not other tables (User, WorkspaceMember already minimal):**

- No `SearchQueryRow` child table — normalized data lives in `normalizedJson` (jsonb) because GSC rows are top-N analytic slices, not transactional entities needing relations. If future needs per-query history, add `SearchQuerySnapshot` child table.
- No `Evidence` separate table — embedded in `Recommendation.evidenceJson`.
- No `AuditLog` yet; add if compliance requires (workspace vs property access).

### 11.2 Migrations

Prisma `migrate` with initial `V1__initial_schema.sql`. Seed not needed; mock data seeds are test fixtures.

### 11.3 Prisma Client

Enable `select` guards — never select `encryptedAccessToken` by default; explicit `select: { encryptedAccessToken: true }` only inside `TokenService`.

---

## 12. API Endpoint Proposal

Base ` /api/v1`, JSON, REST. All endpoints require auth (except OAuth start/callback + public marketing). Auth via httpOnly session cookie (see §13). Rate limiting per route.

### 12.1 Auth

| Method | Path | Purpose | Auth guard |
|--------|------|---------|------------|
| `POST /auth/sign-up` | Create user + workspace | Email, password (zod) | none, rate 5/min/IP |
| `POST /auth/log-in` | Start session | | none |
| `POST /auth/log-out` | Clear session | | session |
| `GET /auth/me` | Current user + workspace list | | session |
| `GET /auth/google/start` | OAuth initiation | | session |
| `GET /auth/google/callback` | Code exchange | | query state |
| `POST /auth/google/revoke` | Disconnect GSC | | workspace auth |
| `GET /workspaces` | List user's workspaces | | session |
| `POST /workspaces` | Create workspace | | session |
| `GET /workspaces/:workspaceId/members` | List members | | workspace member |

### 12.2 Workspace-scoped (require `X-Workspace-Id` header or `workspaceId` in path)

Prefer path param `:workspaceId` for explicitness and auditability (`/workspaces/:workspaceId/properties`). Middleware sets `request.workspaceId`.

| Method | Path | Returns | Notes |
|--------|------|---------|-------|
| `GET /workspaces/:wid/properties` | `SearchConsoleProperty[]` (from DB sync, not raw GSC) | workspace auth, cached 1h after sync |
| `POST /workspaces/:wid/properties/sync` | `{synced: number}` | Triggers `sites.list` → upsert `SearchProperty`; rate 1/5m per workspace |
| `GET /workspaces/:wid/properties/:pid` | `SearchProperty` | 404 if wrong workspace |
| `GET /workspaces/:wid/properties/:pid/snapshot` | `Result<SearchPerformanceSnapshot, DataError>` | `?period=28d` optional; fetches cached snapshot or 404 + trigger ingestion hint |
| `POST /workspaces/:wid/properties/:pid/ingest` | `{jobId}` | Manual ingestion trigger |
| `GET /workspaces/:wid/properties/:pid/recommendation` | `RecommendationResult` | The "one thing" — cooks `NoFixReason` mapping server-side |
| `GET /workspaces/:wid/properties/:pid/fix` | `ProductFix | null` + `noFixReason` | Current fix (adapter output) |
| `POST /workspaces/:wid/properties/:pid/fix/:fixId/review` | `ProductFix` | `mark reviewed` |
| `POST /workspaces/:wid/properties/:pid/fix/:fixId/apply` | `ProductFix` (+baseline) | Captures baseline |
| `POST /workspaces/:wid/properties/:pid/fix/:fixId/check` | `FixOutcome` | Measure now (rate 1/10m) |
| `POST /workspaces/:wid/properties/:pid/fix/:fixId/acknowledge` | `void` | Clears current |
| `POST /workspaces/:wid/properties/:pid/fix/:fixId/dismiss` | `HistoryItem` | `{reason: DismissReason}` |
| `GET /workspaces/:wid/properties/:pid/history` | `HistoryItem[]` | Paginated |
| `GET /workspaces/:wid/properties/:pid/history/:historyId` | `HistoryItem` | |
| `GET /workspaces/:wid/connections/status` | `{status, googleAccountEmail?, workspaceId}` | Replaces `GoogleConnection` polling |
| `GET /workspaces/:wid/jobs/:jobId` | `IngestionJob` | For analysis polling |

### 12.3 Validation

- `zod` DTOs via NestJS `ValidationPipe` (`whitelist, forbidNonWhitelisted, transform`).
- `propertyId` is cuid uuid; legacy mock string ids rejected with `PROPERTY_NOT_FOUND`.
- `startDate/endDate` ISO, validated 16-month window.
- All list endpoints paginate (`?limit=25&offset=0`).

### 12.4 Frontend integration plan (not yet, for reference)

- Frontend replaces `lib/mock/session-context` reads with `fetch('/api/v1/...', {credentials: 'include'})`.
- `SearchDataProvider` implemented as `ApiSearchDataProvider` calling REST, mapping `DataError` codes directly (no string parsing).
- `lib/data-contract/adapters` reused client-side — backend already returns canonical `Recommendation` so adapter composition stays.

---

## 13. Authentication / Session Strategy

### 13.1 Choice: httpOnly secure session cookies (not JWT in localStorage)

- **Why:** Frontend currently uses `localStorage` for mock session — insecure, XSS-exposed. Production must use `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` 7d, `__Host-` prefix if host-only.
- **Session store:** Two options — (a) stateless signed JWT in cookie (no DB lookup) or (b) stateful session id in cookie → DB/Redis. **Proposed: (b) Redis-backed session id** (simpler revocation, explicit logout, workspace isolation per request). `connect-redis` or custom `SessionStore`.
- **Stack:** `passport` local strategy for email/password (`bcrypt` hash), `express-session` with `session` cookie. NestJS `SessionGuard` reads `request.session.userId`.

### 13.2 Endpoints

- `POST /auth/sign-up` → create `User`, hash password, create `Workspace` + `WorkspaceMember(owner)`, set session cookie, return `{user, workspace}`.
- `POST /auth/log-in` → verify password, set session.
- `POST /auth/log-out` → destroy session, clear cookie.
- `GET /auth/me` → return `user` + `workspaces` from session.

### 13.3 CSRF

- With `SameSite=Lax` cookie, cross-site POST is blocked for top-level navigations but not all cases. Add **double-submit CSRF token** for state-changing routes: `GET /auth/csrf` returns `{csrfToken}` stored in `XSRF-TOKEN` httpOnly? Instead use `csrftoken` cookie (not httpOnly) + `X-CSRF-Token` header. NestJS `CsrfGuard` validates.
- OAuth `state` is separate CSRF (see §5).

### 13.4 Rate limiting

- `POST /auth/*` — 5/min/IP + 20/day/IP (via `@nestjs/throttler` + Redis).
- Use `ThrottlerGuard` globally; specific overrides per route.

---

## 14. Workspace / Property Authorization Model

### 14.1 Axioms

1. One workspace must never access another workspace's data.
2. One property must never leak into another property's analysis.
3. Every query is implicitly `WHERE workspaceId = :callerWorkspaceId`.

### 14.2 Enforcement

- **Guard:** `WorkspaceAuthGuard` — reads `request.session.userId`, looks up `WorkspaceMember` for `:workspaceId` (from path `wid` or header `x-workspace-id`), sets `request.workspaceId`, returns 403 if not member. No fallback to query-only filtering.
- **Prisma middleware:** `prisma.$use` to auto-append `workspaceId` to `findMany`/`findFirst` for `SearchProperty`, `SearchDataSnapshot`, `Fix`, `Recommendation` — defense in depth; if guard bypassed, still filtered. Also logs warning if query without `workspaceId`.
- **DB constraint:** `@@unique([workspaceId, siteUrl])` and `@@unique([propertyId, periodStart, periodEnd, rawResponseHash])` ensure no accidental cross-workspace inserts via race. Migrations add `CHECK` constraint `workspaceId IS NOT NULL` on relevant tables.
- **Property ownership check:** `IngestService` does `prisma.searchProperty.findFirst({where: {id: propertyId, workspaceId}})`, else `PROPERTY_NOT_FOUND`. No second check on `siteUrl` — `id` is authoritative.

### 14.3 Roles

- v1: `owner` (full) vs future `member` (read+apply). Enforce via `WorkspaceMember.role` but currently all operations gated to member; only workspace deletion restricted to owner.

### 14.4 Auditability

- `IngestionJob.workspaceId`, `SearchDataSnapshot.workspaceId` logged with every BullMQ job payload. No `userId` in job beyond workspace — jobs not user-scoped.
- Add `AuditLog` later: `{workspaceId, userId, action: "properties.sync"|"fix.apply", propertyId?, createdAt}` for compliance.

---

## 15. Redis / BullMQ Job Architecture

### 15.1 Why BullMQ

- GSC ingestion is I/O-bound, rate-limited, retry-safe, needs idempotency and scheduling — fits BullMQ. Requirement: Redis + BullMQ.

### 15.2 Queues

| Queue | Concurrency | Purpose | Key opts |
|-------|-------------|---------|----------|
| `ingest` | 3 per worker | `IngestSearchData` {workspaceId, propertyId, siteUrl, periodStart, periodEnd} → GSC query → normalize → snapshot | `attempts 3, backoff exponential 5s, removeOnComplete 100, removeOnFail 500` |
| `recommendation` | 5 | `GenerateRecommendation` {snapshotId} → engine → upsert Recommendation + Fix | triggered via `snapshot.ingested` event (QueueEvents) or directly after ingest processor |
| `measurement` | 2 | `EvaluateOutcome` {fixId} → post-apply snapshot comparison | scheduled at `expectedMeasurementDate` via `delay` |
| `token-refresh` | 2 | `RefreshTokens` sweep | repeatable cron `*/30 * * * *` |

### 15.3 Processors (NestJS `@Processor`)

- `IngestProcessor` — idempotent: check existing `SearchDataSnapshot` with `rawResponseHash`; if same, skip; else upsert. Acquire `redlock` on `lock:ingest:{propertyId}:{periodStart}:{periodEnd}` (via `ioredis` + `redlock`) to prevent duplicate concurrent ingest for same period.
- `RecommendationProcessor` — loads `SearchPerformanceSnapshot` from `snapshot.normalizedJson`, runs pure `RecommendationEngine.evaluate`, writes `Recommendation` + `Fix(available)` (or updates `RecommendationResult` honest empty as `Recommendation.status` = no_signal etc). For honest empties, no `Fix` created.
- Rate limiting within processors: per-site QPM token bucket (in Redis) — `INCR` with 60s TTL for `gsc:qpm:{siteUrl}`; if ≥1200, delay job `60s` and retry.

### 15.4 Scheduling

- **Repeatable jobs:** `daily-ingest: sweep` via `queue.add('sweep', {}, {repeat: {pattern: '0 4 * * *'}, jobId: 'daily-sweep'})`. Sweep handler enqueues one `ingest` job per active property (staggered via `delay: rand(0,60)*60*1000`).
- **Per-property after apply:** `measurement` queue `add('evaluate', {fixId}, {delay: 14*24*60*60*1000, jobId: `measure:${fixId}`})`. Frontend manual "Check now" bypasses delay via `POST /fixes/:id/check` which enqueues immediately.

### 15.5 Failure & retry

- Safe retries (idempotent): ingest retries on 429/500/503 only; 400/403/404 fail fast (no retry).
- `lastError` stored on `IngestionJob` for observability.
- Dead-letter: failed jobs kept 7d for manual re-drive.

### 15.6 Redis topology

- Single Redis instance via Docker Compose `redis:7-alpine` (no cluster v1).
- BullMQ uses same Redis but separate keyspace prefix `bull:`.
- Session store (`connect-redis`) shares Redis instance, key prefix `sess:`.

---

## 16. Error Handling Strategy

### 16.1 DataErrorCode mapping (canonical, per `errors.ts`)

| Backend / Google / DB error | `DataError.code` | Message (user-safe) | HTTP | Retry |
|-----------------------------|------------------|---------------------|------|-------|
| No session / expired cookie | `AUTH_REQUIRED` | "Sign in again." | 401 | no |
| Workspace not member | `PERMISSION_DENIED` | "You don't have access to this workspace." | 403 | no |
| `SearchProperty` not in workspace | `PROPERTY_NOT_FOUND` | "We couldn't find that property in this workspace." | 404 | no |
| GSC `siteUnverifiedUser` / 403 | `PERMISSION_DENIED` | "RENKO doesn't have access to this property. Reconnect Search Console." | 403 | no |
| GSC 401 `invalid_grant` / token expired | `AUTH_REQUIRED` | "Your Search Console connection expired. Reconnect." | 401 | no (needs reauth) |
| GSC query `rows: []` but period valid | `NO_DATA` | "No Search Console data for this period." | 200 (RecommendationResult unavailable) | no |
| GSC query with <threshold impressions | `INSUFFICIENT_DATA` | "Not enough search activity to recommend confidently." | 200 (status insufficient-data) | no |
| Snapshot `freshness: delayed` | `STALE_DATA` | "Search Console hasn't reported new data yet." | 200 | yes (ingest job retry) |
| Snapshot `quality: partial` | `PARTIAL_DATA` | "Some data is incomplete — see limitations." | 200 (with meta.limitations) | no |
| GSC `429 quotaExceeded` | `RATE_LIMITED` | "RENKO hit a Search Console rate limit. Try again shortly." | 429 + `Retry-After` | yes (exponential) |
| GSC 500/503 | `UPSTREAM_ERROR` | "RENKO couldn't reach Search Console right now." | 502 | yes |
| Prisma `P2025` not found | `PROPERTY_NOT_FOUND` | (as above) | 404 | no |
| Unknown | `UNKNOWN_ERROR` | "Something went wrong." | 500 | no |

**Implementation:** `DomainError` class with `code: DataErrorCode`, `message`, `cause?`, `retryable: boolean`. Global `HttpExceptionFilter` maps to `{error: {code, message}}` shape — matches frontend `DataError`. Never include stack/raw payload in response.

### 16.2 Logging errors

- Structured `error` log includes `code`, `workspaceId`, `propertyId`, `jobId`, but never tokens. See §19.

### 16.3 Validation errors

- `ValidationPipe` failures → `400 {code: "VALIDATION_ERROR", message: details}` where `VALIDATION_ERROR` is outside `DataErrorCode`? Recommend extend `DataErrorCode` to include `VALIDATION_ERROR` or map to `UNKNOWN_ERROR` with 400. Minimal compatible change: add `VALIDATION_ERROR` to `errors.ts` in later prompt (frontend handles unknown codes as generic error).

---

## 17. Freshness / Data-Quality Strategy

### 17.1 Freshness

Derived in `SearchDataMeta.freshness: fresh|delayed|stale|unavailable`:

| Condition | `freshness` |
|-----------|------------|
| `dataThrough == period.end` and `now - dataThrough < 3d` and `metadata.firstIncompleteDate` absent | `fresh` |
| `now - dataThrough 3–7d` or `firstIncompleteDate` equals `dataThrough+1d` | `delayed` |
| `now - dataThrough > 7d` | `stale` |
| No snapshot or GSC 5xx | `unavailable` |

Backend sets `retrievedAt=nowIso()` on ingestion. `dataThrough` computed as `period.end` for `final` data, or `min(period.end, firstIncompleteDate -1d)` for `all`.

### 17.2 Quality

| Condition | `quality` |
|-----------|----------|
| Rows ≥ threshold (e.g., >20 queries, >500 impressions) and all metrics sane | `complete` |
| Rows truncated (25K limit hit, pagination short) or anonymized gap detected | `partial` |
| Rows 0 or <missing threshold (e.g., <50 impressions over 28d) | `missing` |
| `freshness=delayed` but not yet stale | `delayed` |
| Before vs after snapshots disagree (clicks up, position down beyond band) | `conflicting` |
| No data / 403/5xx | `unavailable` |

`quality=missing` → `RecommendationResult.status=insufficient-data`; `quality=delayed` or `freshness=stale/delayed` → `stale-data`; otherwise engine evaluation.

### 17.3 Limitations strings

- "Only the top 25 queries were returned — the full tail is truncated." (when `rowLimit` truncated)
- "Some rare queries are withheld for privacy — totals won't sum from breakdowns." (always add when anonymized detected or by default for query-grouped queries)
- "Search Console hasn't reported new data in over a week." (when stale)
- "Grouping by page/query may omit low-volume data for performance." (disclose per GSC docs)

Rendered in `EvidenceDrawer.tsx` `meta.limitations` list and `EmptyFixState` copy.

### 17.4 Handling partial/delayed/conflicting/unavailable honestly

- Never fabricate recommendation to fill slot — return honest `RecommendationResult` status (`RecommendationResultStatus` 5 values are sufficient; `DataError` codes handle finer granularity).
- Frontend `EmptyFixState` branches on `noFixReason` (mapped from `RecommendationResultStatus`) already cover `insufficient-data`, `stale-data`, `connection-error`, `no-fix`. For `unavailable` backend may map to `connection-error` (as `adapters.ts:89-102` does: `unavailable → connection-error`).

---

## 18. Security Model

### 18.1 Token security

- **Encryption:** `TokenEncryptionService` AES-256-GCM with 12B nonce, 16B tag, 32B key from `GOOGLE_TOKEN_ENCRYPTION_KEY` base64. Key not in repo, via env only (`docker-compose.yml` env_file or secret mount). Rotation via `keyVersion` column + `KEK` version header.
- **Never expose:** No endpoint returns `access_token` or `refresh_token`. `GET /connections/status` returns only `googleAccountEmail`, `status`, `lastRefreshedAt`.
- **Logging:** `pino` serializer redacts `authorization`, `cookie`, `encrypted*Token` fields. Safe logging: `logger.info({workspaceId, propertyId, action}, "ingest enqueued")` with no PII.

### 18.2 Session & cookies

- `httpOnly`, `Secure` (prod), `SameSite=Lax`, `__Host-session` name, `Max-Age` 7d, path `/`.
- Session id 32B random, stored in Redis (`sess:`), not JWT.
- Logout destroys Redis key + clears cookie.

### 18.3 CSRF & state

- OAuth `state` httpOnly cookie (`oauth_state`) + server validation.
- CSRF double-submit for `POST/PUT/DELETE` under `/api/v1` (except OAuth callback). Frontend fetches `GET /auth/csrf` on load, sends `x-csrf-token`.

### 18.4 Authorization

- Every data query requires `WorkspaceAuthGuard` + `WHERE workspaceId`.
- Prisma middleware double-enforces.
- `propertyId` is opaque cuid; path traversal via `../` handled by NestJS param validation (UUID).

### 18.5 Input validation

- `ValidationPipe` with `class-validator` + `zod` for nested GSC payloads.
- `siteUrl` validated regex; dates validated ISO + 16-month window + `start <= end`; `rowLimit 1-25000`.

### 18.6 Rate limiting

- Global `ThrottlerGuard` via Redis (`@nestjs/throttler-storage-redis`): `ttl 60s, limit 60` per IP for API; tighter `5/min` for `auth/*`, `1/5m` for `properties/sync`, `1/10m` for `fixes/:id/check`.
- GSC internal QPM token bucket (Redis `gsc:qpm:{siteUrl}`) inside `IngestProcessor` to avoid GSC `quotaExceeded`.

### 18.7 Secret management

- Env-only: `DATABASE_URL`, `REDIS_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `CSRF_SECRET`.
- `.env` not committed (`.gitignore` + `.env.example` with placeholders like `GOOGLE_CLIENT_ID=...` and `GOOGLE_TOKEN_ENCRYPTION_KEY=base64-32B`).
- Docker Compose reads `env_file: .env`.

### 18.8 DB constraints for isolation

- `@@unique([workspaceId, siteUrl])`, FK cascades, `CHECK` `workspaceId NOT NULL`, optional Postgres RLS policies.

---

## 19. Observability / Logging Strategy

### 19.1 Logging

- **Library:** `pino` + `@nestjs/pino` or `nestjs-pino` (`pinoHttp`).
- **Format:** Structured JSON. Fields: `timestamp, level, msg, requestId, workspaceId, propertyId, userId, jobId, durationMs, route, errorCode`.
- **Redaction:** `pino` `redact: ["req.headers.authorization", "req.headers.cookie", "encryptedAccessToken", "encryptedRefreshToken"]`.
- **Levels:** `info` for job enqueue/complete, `warn` for `RATE_LIMITED`/`STALE_DATA`, `error` for `UPSTREAM_ERROR`/`UNKNOWN_ERROR`.
- **No secrets in logs:** verified via test that `TokenEncryptionService` fields are excluded.

### 19.2 Request id

- `X-Request-Id` header — generate `cuid` if missing, propagate via `AsyncLocalStorage`, log on every line, return in response.

### 19.3 Metrics

- Minimal v1: `prom-client` endpoint `/metrics` (auth-gated or network-restricted) with counters `gsc_queries_total{siteUrl,status}`, `ingest_jobs_total{status}`, `recommendations_generated_total{result}`, histogram `gsc_query_duration_seconds`.
- Redis queue metrics via BullMQ `Queue.getJobCounts()` exposed on `/health`.

### 19.4 Health checks

- `GET /health` → `{status, db: "ok"|"down", redis: "ok"|"down", gsc: "unknown"}` — liveness. `GET /health/ready` checks DB + Redis connectivity.
- Docker `HEALTHCHECK CMD curl -f http://localhost:3000/api/v1/health || exit 1`.

### 19.5 Tracing (future)

- OpenTelemetry optionally wired via `nestjs-otel` but not required v1; keep hooks for later.

---

## 20. Docker / Deployment Architecture

### 20.1 Local development (Docker Compose)

```
renko/
  docker-compose.yml
  apps/
    api/               NestJS (port 3000)
  prisma/
  .env.example
  .env                 (gitignored)
```

```yaml
# docker-compose.yml
version: "3.9"
services:
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    ports: ["3000:3000"]
    env_file: .env
    environment:
      DATABASE_URL: postgresql://renko:renko@db:5432/renko
      REDIS_URL: redis://redis:6379
    depends_on: { db: {condition: service_healthy}, redis: {condition: service_healthy} }
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: renko, POSTGRES_PASSWORD: renko, POSTGRES_DB: renko }
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U renko"], interval: 5s, retries: 5 }
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes: [redisdata:/data]
    healthcheck: { test: ["CMD","redis-cli","ping"], interval: 5s, retries: 5 }
volumes: { pgdata: {}, redisdata: {} }
```

### 20.2 API Dockerfile

Multi-stage: `node:20-alpine` builder → `npm ci` → `npx prisma generate` → `npm run build` → runtime `node:20-alpine` with `dist/`, `prisma/`, non-root user, `HEALTHCHECK`.

### 20.3 Frontend integration (separate compose or same network)

Frontend Next.js remains outside Compose for now (`renko-frontend` on host `3001`), proxies `/api/v1` to `api:3000` via `next.config.ts` rewrite or env `NEXT_PUBLIC_API_BASE=http://localhost:3000`. Production puts both behind same reverse proxy (nginx/Caddy) with TLS.

### 20.4 Production checklist (before deploy)

- `GOOGLE_CLIENT_ID/SECRET` from real Google Cloud project, redirect uri whitelisted (`https://api.renko.app/auth/google/callback`).
- OAuth consent screen `In production` (not testing) to avoid 7-day refresh expiry + verification for `webmasters.readonly` (sensitive scope).
- `SESSION_SECRET` strong random, `GOOGLE_TOKEN_ENCRYPTION_KEY` 32B base64, `DATABASE_URL` with TLS, `REDIS_URL` with password.
- Migrations run on deploy (`npx prisma migrate deploy`).
- `Secure` cookie enabled (requires HTTPS).
- Logs shipped to aggregator, metrics scraped.

---

## 21. Testing Strategy

### 21.1 Shape

- **Unit (no DB/GSC):** Pure functions — `normalizeSearchAnalyticsResponse`, `RecommendationEngine.evaluate`, `TokenEncryptionService`, `SearchPeriod` validators, `DataError` mappers. Run with `jest`/`vitest`. Examples:
  - Normalize clamps `ctr`, converts page full URL→path, handles empty rows, detects anonymized gap.
  - Engine returns `no-signal` when impressions < threshold, picks max-impression page.
- **Integration:** NestJS `Test.createTestingModule` with `prisma` test DB (isolated via `DATABASE_URL_TEST`), Redis in-memory (`ioredis-mock` or `testcontainers`). Tests:
  - Workspace isolation: create two workspaces, insert property in ws1, assert `GET /workspaces/ws2/properties/:id` 404, direct Prisma middleware blocks.
  - OAuth token encrypt/decrypt round-trip, `state` validation rejects mismatch.
  - BullMQ job idempotency: enqueue same ingest twice concurrently → one snapshot.
  - Ingest handles GSC 429 with retry, 403 maps to `PERMISSION_DENIED`.
- **E2E (no live GSC):** `InMemoryMockProvider` seeded with `MockSearchDataProvider` fixtures returns exact `SearchPerformanceSnapshot` from `mock-provider.ts`; entire flow `POST /properties/sync → POST /ingest → GET /recommendation → POST /fix/apply → POST /fix/check` tested via `supertest` with session cookie.
- **Live GSC (manual, skipped in CI):** Opt-in test gated by `GSC_LIVE_TEST=1` + real refresh token; asserts `sites.list` returns at least one property and `searchAnalytics.query` returns `clicks` for `sc-domain:` fixture.

### 21.2 Existing frontend tests preserved

- `lib/data-contract/tests/*.test.ts` remain runnable via `npm test` (`node --experimental-strip-types --test`). Backend adopts same `Provider` contract so frontend tests still pass when `ApiSearchDataProvider` replaces mock. Keep them as contract regression suite; run in CI alongside backend tests.

### 21.3 Coverage expectations

- Critical paths: property isolation, token storage, ingest idempotency, freshness computation, `DataError` mapping. Target ≥80% for those modules; overall ≥70% v1.

---

## 22. Migration Strategy From Current Mock Provider to Real Provider

### 22.1 Principles

- Frontend contracts frozen; backend implements server-side `SearchDataProvider` — no component change for happy path.
- Mock layer (`lib/mock/*`, `lib/data-contract/mock-provider.ts`) is **deleted**, not migrated. `SessionContext` `localStorage` logic replaced.

### 22.2 Phases

**Phase A — Backend-only (no frontend change):**

1. Scaffold NestJS `apps/api` with Prisma schema (see §11), Docker Compose.
2. Implement `SearchConsoleProvider` with `InMemoryMockProvider` backing — backend tests pass using same mock fixtures as frontend.
3. Add auth/session, workspace/property guards with empty DB.

**Phase B — Thin API parallel to mocks:**

4. Add REST endpoints from §12 returning canonical types; frontend still reads mocks. Verify via `curl` with session cookie.
5. Implement `GscSearchConsoleProvider` behind env toggle `GSC_MOCK=false` (still not wired to frontend).

**Phase C — Frontend cutover (feature-flagged):**

6. Create `lib/data-contract/api-provider.ts`: `class ApiSearchDataProvider implements SearchDataProvider` that `fetch`es backend REST, maps HTTP `DataError` json to `DataError` codes, handles `AUTH_REQUIRED` → redirect to `/log-in`.
7. Add env `NEXT_PUBLIC_USE_REAL_PROVIDER=1` toggle in `lib/mock/product-service.ts` call sites: if flag set, import `ApiSearchDataProvider` else `MockSearchDataProvider`. `session-context.tsx` gains `workspaceId` from backend (`GET /auth/me`).
8. Migrate `AnalysisStatus` polling: replace `mockAnalysisService.runAnalysis` polling loop with `GET /properties/:id/ingest` job status polling (`GET /jobs/:id`). UI states already support `queued|connecting|loading-data|analyzing|ranking|complete` (from `AnalysisStatus` 10 values) — reuse.

**Phase D — Delete mocks:**

9. Remove `lib/mock/search-console-service.ts`, `analysis-service.ts`, `auth-service.ts` implementations (keep type exports until all consumers updated). Replace `mock-provider.ts` with `InMemoryMockProvider` only in backend tests.
10. Update `SessionProvider` to be thin wrapper over `GET /auth/me` + `GET /workspaces/:wid/properties/:id/fix` etc — no `localStorage`, no `seedPropertyState`. `seedPropertyState` logic moves to backend ingest seed? Not needed — real data replaces it.

### 22.3 Back-compat shims

- Keep `lib/data-contract/types.ts` untouched; backend `Recommendation` JSON matches it exactly so frontend `recommendationToProductFix` adapter still works.
- Keep `formatCtr` / `toEvidenceRow` client-side; backend keeps numeric `ctr`.
- `SearchDataMeta.period.label` computed backend but frontend may still call `makeTrailingPeriod` for fallback label.

### 22.4 Rollback

- Feature flag `NEXT_PUBLIC_USE_REAL_PROVIDER` off → instant mock fallback for incident. No DB rollback needed because mock writes never touched DB.

---

## 23. Risks and Unknowns

| # | Risk / Unknown | Impact | Likelihood | Mitigation |
|---|----------------|--------|------------|------------|
| R1 | GSC `siteUrl` encoding: `sc-domain:example.com` must be `encodeURIComponent` and `permissionLevel` may be `siteRestrictedUser` despite owner expecting access | 403 mis-mapped to `PROPERTY_NOT_FOUND` vs `PERMISSION_DENIED` | High | Validate via `sites.get` before query; log raw `siteUrl` + permission; integration tests for both domain and url-prefix fixtures |
| R2 | Anonymized query tail + page/query grouping dropping data → `Recommendation` based on incomplete view may misrank | False recommendation or missed signal | High | Always add limitations, sample `byProperty` totals vs breakdown to detect large gap, require `quality=partial` to suppress strong language |
| R3 | GSC load quotas + `rowLimit=25K` pagination multiplying QPM under concurrent workspace polling | 429 `quotaExceeded` spike at scale | Medium | Per-site QPM token bucket, staggered daily sweep with jitter, batch `dimensions: ["page","query"]` not per-page fan-out, cache snapshots 24h |
| R4 | `refresh_token` only on first consent — lost token forces full re-consent; 100-token cap may invalidate old tokens for power-test accounts | Connection goes `expired` silently | Medium | Upsert connection with `WHERE refresh_token IS NULL` guard to not blank without new token; store immediately; monitor 100-cap via logging oldest token age |
| R5 | Testing publishing status 7-day refresh expiry (hidden) | All connections expire after 7 days in staging if not set to In production | Medium | Set OAuth consent to In production before staging integration; document 7-day caveat in README |
| R6 | Frontend workspace model gap: no `workspaceId` in `OnboardingState` | Backend requires workspace isolation but frontend sends no id | High | Additive `workspaceId` field to `OnboardingState` + `GET /auth/me` returning workspaces; keep `workspaceName` for display |
| R7 | Data latency 2–3 days means `dataThrough` trails `now` — recommendation may be based on old data while user expects today | Perceived staleness, `stale-data` frequent | High | Freshness derivation in §17 + UI copy via `EmptyFixState` stale branch + `limitations` |
| R8 | 16-month historical limit + period inclusive PT conversion | Off-by-one date or rejected period for legitimate comparison window | Medium | Central `toPtDate` helper, zod validation `start >= now-16M`, tests around DST boundaries |
| R9 | Search Analytics `position` is average, not per-query rank; CTR by position curve not provided by API | Signal heuristic may misfire without baseline curve | Medium | Keep thresholds relative (`comparisonPage` delta) not absolute curve; log threshold decisions for tuning without fabricating score |
| R10 | Google API 50K rows/day/type top-N sort by clicks — long-tail pages may never appear in recommendation | Missed opportunity for low-volume but high-intent pages | Medium | Document limitation; future add `sitemaps` or page-list driven iteration over known pages (but not v1) |
| R11 | PricingConfig `propertyLimit` 1 or 10 must be enforced server-side but frontend `History` may show >limit if imported | Billing bypass | Low | `Workspace.plan` + `COUNT(SearchProperty)` guard on `properties/sync` with `402 Payment Required` DataError (extend codes) |
| R12 | Encryption key rotation without downtime | Old tokens undecryptable after key change | Low | `keyVersion` column + `GOOGLE_TOKEN_ENCRYPTION_KEY_V2` rollout, decrypt with old key fallback |

**Unknown requiring spike before code:**

- Exact `searchType` values: `web` vs `type=discover|googleNews` — need to confirm `googleapis` `searchType` param vs `type` legacy alias (docs list both). Spike: call with `discover` and inspect.
- `responseAggregationType` handling when `byPage` requested — does Google echo back or coerce?
- Real `permissionLevel` values for domain vs url-prefix edge cases (Google Help vs API docs slight naming difference).

---

## 24. Exact Implementation Order for the Next Prompts

> Each prompt below is one build increment. Do not combine increments; each must be reviewable, testable, and committable alone. Prompts referenced here are "the next prompts" after this architecture report is approved.

### Prompt 6 — Backend scaffold & schema

1. Initialize NestJS workspace: `apps/api` via `@nestjs/cli` (`nest new api`), share `.eslintrc` with frontend.
2. Add `prisma` + `prisma/schema.prisma` exactly as §11; `npx prisma generate`; `docker-compose.yml` + `Dockerfile` + `.env.example`.
3. Add `ConfigModule` with validated env schema (`@nestjs/config` + `joi`).
4. Add `PrismaModule` (global), `HealthModule` (`/health`, `/health/ready`).
5. Add `PinoLoggerModule` (`nestjs-pino`) with redaction list.
6. Verification: `docker compose up -d --build`, `npx prisma migrate dev`, `GET /health` 200, lint/typecheck pass.

### Prompt 7 — Auth & workspace isolation

1. `AuthModule`: `User` signup/login (`bcrypt`), `Workspace` + `WorkspaceMember` creation, session middleware (`express-session` + `connect-redis`), `POST /auth/sign-up|log-in|log-out`, `GET /auth/me`, `GET /auth/csrf`.
2. `WorkspaceAuthGuard` + `ThrottlerGuard` + Prisma middleware appending `workspaceId`.
3. Tests: property-isolation DB test, session cookie httpOnly flags, CSRF enforcement.
4. Frontend stub: `lib/data-contract/api-provider.ts` skeleton not yet wired.

### Prompt 8 — Google OAuth connection

1. `GoogleOAuthModule`: `TokenEncryptionService` (AES-256-GCM), `GET /auth/google/start` (state cookie), `GET /auth/google/callback` (exchange, encrypt, upsert `SearchConsoleConnection`), `POST /auth/google/revoke`, `GET /connections/status`.
2. Env `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI/TOKEN_ENCRYPTION_KEY` via `.env.example`.
3. Tests: state mismatch rejects, refresh_token stored, no token leakage in responses, `InMemory` google token endpoint mock.

### Prompt 9 — Sites & property sync

1. `SearchConsoleModule` with `SearchConsoleProvider` interface + `GscSearchConsoleProvider(fetch)` + `InMemoryMockProvider`.
2. Endpoints `GET /workspaces/:wid/properties`, `POST /workspaces/:wid/properties/sync` (calls `sites.list` → upsert `SearchProperty` with `permissionLevel`, `type` derived from `siteUrl` prefix).
3. Permission gating: only `siteOwner|siteFullUser` → `selectable:true`.
4. Tests: domain vs url-prefix parsing, isolation, sync idempotency.

### Prompt 10 — Ingestion & normalization

1. `IngestionModule`: `IngestProcessor` (BullMQ `ingest` queue, `ioredis`), `SearchDataNormalizer` (pure, §8), `SearchDataSnapshot` upsert, `GET /workspaces/:wid/properties/:pid/snapshot` (cached), `POST .../ingest`.
2. PT date conversion helpers, zod validation for GSC response, `limitations` collection.
3. Redis lock + QPM bucket, pagination via `startRow`.
4. Tests: fixture GSC JSON → normalized snapshot, anonymized gap detection, 16-month rejection, 429 retry.

### Prompt 11 — Recommendation engine & measurement

1. `RecommendationModule`: `RecommendationEngine.evaluate(snapshot)` (thresholds in `signal-config.ts`), `Recommendation` + `Fix` persistence, endpoints `GET /recommendation`, `GET /fix`, `POST /fix/:id/review|apply|dismiss|acknowledge`, `POST /fix/:id/check` → `FixOutcome` helper.
2. Measurement scheduler (`measurement` queue with delay 14d).
3. `FixWorkspace` honest status mapping to `RecommendationResultStatus` + `NoFixReason`.
4. Tests: fix lifecycle `available→applied→measured`, outcome classification, non-causality strings, determinism.

### Prompt 12 — Hardening & deployment

1. Revisit all guards (RLS optional), add `AuditLog`, refine `DataError` mapping for every Google HTTP code, add `prom-client` metrics, tighten Dockerfile (non-root, healthcheck), document production checklist (§20.4).
2. End-to-end smoke with `GSC_MOCK=false` against one real property (manual gate) and run `docs/backend-architecture.md` verification checklist: `typecheck`, `lint`, `npm test` (both frontend + backend).

**Ordering constraints:** Do not implement OAuth (§5) before auth/session (§13). Do not implement ingest (§7) before `SearchConsoleProvider` + token refresh. Do not implement recommendation (§9) before normalization (§8). Keep each PR <500 lines excluding fixtures.

---

## 25. Do Not Implement Yet

The following are explicitly **out of scope** until the architecture above is approved and the implementation order in §24 is complete in order. They must not be started in this or the next prompt:

- Keyword research, rank tracking, backlink analysis, technical SEO crawler, content writer/editor, GEO/AEO dashboard, generic SEO audit, competitor dashboard, agency portal, reports, report export, PDF generation — all violate "micro-SaaS focused" principle.
- Billing / Stripe / subscription enforcement beyond `Workspace.plan` placeholder (`propertyLimit` is display-only in `pricing-config.ts:65-93`).
- Real-time hourly `HOUR` dimension analysis (`hourly_all`, 10-day hourly breakdown) — not needed for 28-day windows; keep `final` vs `all` only.
- Multi-property batch dashboard or cross-property analytics (breaks property isolation invariant).
- Full i18n / locale support beyond `formatDate` en-US UTC existing helper.
- Service accounts (`service_account` OAuth) for GSC — keep per-user refresh tokens only.
- Search Appearance / Discover / Google News separate searchTypes (requires two-step queries); v1 uses `searchType=web` only.
- Any addition of `confidence` score, SEO grade, or causal language in recommendations.
- Production credentials generation (`GOOGLE_CLIENT_SECRET` etc) — leave as env placeholders in `.env.example`.
- Migration of `lib/mock` data into production DB seeds — mocks are deleted, not migrated.
- Background cron beyond daily ingest and measurement delay — no weekly ranking job until ingestion proven stable.

**If a request conflicts with this list, document the conflict in `docs/backend-architecture.md` risks (§23) and propose the smallest compatible change — do not expand scope.**

---

## 26. Verification Results

Verification was run **after** writing this architecture report. The report does not change application code, so all checks are expected to pass as before (or report pre-existing failures).

Commands executed from `C:\Users\zari\Desktop\renko-frontend`:

```
npm run typecheck   # tsc --noEmit
npm run lint        # next lint (eslint.config.mjs)
npm test            # node --experimental-strip-types --test lib/data-contract/tests/*.test.ts
npm run build       # next build
```

| Check | Result | Notes |
|-------|--------|-------|
| `typecheck` | **PASS** | No type errors — report is markdown, no TS change |
| `lint` | **PASS** | `eslint.config.mjs` flat config; no new files linted (markdown excluded) |
| `test` | **PASS** | `lib/data-contract/tests/*.test.ts` 6 suites, all green (property-isolation, adapters, errors, dates, mock-provider, outcome) |
| `build` | **PASS** | Next.js 15 build succeeds; `docs/` not part of compiled output |

If any of these had failed, the failure message, whether it existed before this change, and the file responsible would be listed here. No failures observed at report date. Future implementers must re-run these after each prompt in §24.

---

## 27. Appendices

### A. Files inspected

```
app/layout.tsx
app/(marketing)/page.tsx, /pricing/page.tsx, /privacy/page.tsx, /terms/page.tsx, /contact/page.tsx
app/(auth)/sign-up/page.tsx, /log-in/page.tsx
app/(product)/home/page.tsx, /fixes/page.tsx, /history/page.tsx, /history/[fixId]/page.tsx, /settings/page.tsx
app/onboarding/{create-workspace,connect-search-console,select-property,analyzing,first-fix}/page.tsx
components/product/{HomeContent,CurrentFixSummary,FixWorkspace,EvidenceDrawer,OutcomeCard,EmptyFixState,HistoryContent,HistoryDetailContent,PropertySwitcher,ProductShell,WhyThisFix,FixesContent}.tsx
components/onboarding/{ConnectSearchConsole,SelectProperty,Analyzing,FirstFixReveal,OnboardingProgress,OnboardingGuard,CreateWorkspaceForm}.tsx
components/auth/{SignUpForm,LogInForm,PasswordInput,GoogleAuthButton,AuthCard}.tsx
lib/data-contract/{types,provider,mock-provider,adapters,dates,errors,loading}.ts
lib/data-contract/tests/{adapters,dates,errors,mock-provider,outcome,property-isolation}.test.ts
lib/mock/{types,product-service,session-context,search-console-service,analysis-service,onboarding,auth-service}.ts
lib/{site-config,pricing-config,design-tokens}.ts
package.json, tsconfig.json, next.config.ts, eslint.config.mjs, tailwind.config.ts
```

### B. Files changed in this prompt

- `docs/backend-architecture.md` — **created** (this file). No other files modified, no dependencies added, no existing behavior changed.
- Verification confirms `git status` shows only `docs/backend-architecture.md` as untracked.

### C. Research sources (authoritative, 2026-09-15)

- OAuth web-server flow, offline access, refresh token, state — `developers.google.com/identity/protocols/oauth2/web-server`, `.../oauth2` (Refresh token expiration), `.../oauth2/scopes`, `.../identity/oauth2/web/guides/choose-authorization-model`
- Search Console API authorizing & scopes — `developers.google.com/webmaster-tools/v1/how-tos/authorizing`, `developers.google.cn/webmaster-tools/v1/how-tos/authorizing`
- Sites resource, permission levels — `developers.google.com/webmaster-tools/v1/sites/list`, `.../sites`, `googleapis.dev/.../searchconsole/interfaces/Schema$WmxSite.html`, `apis.io` OpenAPI `google-search-console-sites-api`, `support.google.com/webmasters/answer/2453966` (Permissions), `.../answer/34592` (Add property), `.../answer/9008080` (Verify), `.../answer/7687465` (Property Settings)
- Search Analytics query, dimensions/metrics, row limits — `developers.google.com/webmaster-tools/v1/searchanalytics/query`, `.../searchanalytics`, `.../how-tos/search_analytics`, `.../how-tos/all-your-data`, `googleapis.dev/.../Params$Resource$Searchanalytics$Query.html`, `googleapis.github.io/google-api-python-client/docs/dyn/searchconsole_v1.searchanalytics.html`, `analyseo.app/blog/google-search-console-api-quotas-limits` (2026-08-16), `metaflow.life/blog/search-console-api-complete-guide-programmatic-seo-reporting` (2026-03-14)
- Quotas & load — `developers.google.com/webmaster-tools/limits` (2024-01-25), `analyseo.app` 2026 quotas summary
- Data latency, dataState, incomplete metadata — `support.google.com/webmasters/answer/96568`, `developers.google.com/webmaster-tools/v1/how-tos/all-your-data` (dataState), `searchengineland.com` 2025-04-09 (hourly 10d), `searchenginejournal.com` / `ppc.land` / `seroundtable.com` 2025-07-14 metadata (`first_incomplete_date` / `first_incomplete_hour`)
- `googleapis` Node.js Search Console interfaces — `googleapis.dev/nodejs/googleapis/latest/searchconsole/...`
- Frontend contract as source of truth — `lib/data-contract/types.ts` layering comment (`DATA SOURCE → … → PRODUCT UI`)

Outdated tutorials were excluded; only official `developers.google.com`, `googleapis.dev`, `support.google.com` primary sources treated as normative for API behavior.

### D. Architecture decisions (ADRs)

| # | Decision | Rationale | Alternatives rejected |
|---|----------|-----------|-----------------------|
| AD1 | Frontend contracts frozen, backend normalizes before recommendation | Honors single-responsibility layering in `types.ts:9-13`; keeps recommendation testable without live GSC | Regenerating types from OpenAPI — would break property-isolation tests |
| AD2 | OAuth Authorization Code + `offline` + `webmasters.readonly` + `openid email` | Least privilege, refresh without user present, account-mismatch UX | `implicit` flow (no refresh), `webmasters` write scope (over-privileged), service account (not per-user) |
| AD3 | `SearchDataSnapshot.normalizedJson` as `jsonb` not child tables | GSC rows are top-N analytic slices; relations add complexity without value v1 | Normalized `SearchQueryRow` table — deferred until per-query history needed |
| AD4 | Ingest → cache → recommend, not per-request GSC proxy | Respects QPM/load quotas, stable recommendations, supports `freshness` honesty | Direct pass-through on `GET /recommendation` — would hit GSC on every page load |
| AD5 | Direct `fetch` over `googleapis` client for GSC queries | Fine-grained control of token refresh, timeout, retry, and `siteUrl` encoding | `googleapis` `searchconsole('v1')` — heavier, hides token handling |
| AD6 | `fetch` uses `dataState=final` for recommendations, optional `all` for freshness probe | Keeps recommendation stable on finalized data; explicit `firstIncompleteDate` for UI warning | Always `all` — would surface still-moving recent data as if final |
| AD7 | Session via Redis `express-session` httpOnly cookies + CSRF double-submit | XSS-safe, explicit revocation, aligns with NestJS idioms | JWT in localStorage — XSS-exposed (matches current insecure mock pattern) |
| AD8 | Workspace isolation via `WorkspaceAuthGuard` + Prisma middleware + DB `@@unique([workspaceId, siteUrl])` triple | Defense in depth; one property must never leak — DB constraint is last line | Guard only — insufficient if future service forgets filter |
| AD9 | BullMQ single Redis instance, 4 queues | Meets requirement (Redis+BullMQ) without over-engineering cluster | `pg-boss` — would conflict with stated Redis requirement |
| AD10 | Pure `RecommendationEngine.evaluate(snapshot): RecommendationResult` with thresholds file | Testable without GSC, no fabricated scores, no causal claims | ML/ranking service v1 — premature without data |

### E. Risks

Summarized in §23 (R1–R12). Top 3 before next prompt:

1. **R1 + R6** block implementation if not fixed: canonical `siteUrl` vs frontend `id` mismatch and missing `workspaceId` will cause 404/isolation bugs on day one — fix via migration shim in Prompt 6/7.
2. **R4** causes silent connection expiry in staging — set consent screen to `In production` and add token `invalid_grant` monitoring.
3. **R2** threatens product honesty — anonymized tail must be disclosed in `limitations`; engine thresholds must be relative (`comparisonPage` delta) not absolute.

### F. Recommended next prompt (exact)

```
Create the NestJS backend scaffold exactly per §24 Prompt 6 of docs/backend-architecture.md.
Do not jump ahead to OAuth or Search Console.

Steps:
- apps/api via @nestjs/cli, TypeScript, shared eslint
- Prisma schema exactly as §11 (copy enum/table names verbatim)
- docker-compose.yml + Dockerfile per §20.1/20.2, .env.example with no secrets
- ConfigModule env validation, PrismaModule, HealthModule (/health, /health/ready), PinoLoggerModule with redaction
- Verify: `docker compose up -d --build`, `npx prisma migrate dev`, `GET /health` 200, `npm --prefix apps/api run typecheck && lint`, `npm --prefix ../../ run typecheck && lint && test && build` (frontend)

Do not implement auth, OAuth, sites, ingestion, recommendation, or any route beyond /health.
```

---

*End of report — awaiting approval before Prompt 6 scaffold.*
