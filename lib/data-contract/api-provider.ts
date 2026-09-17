/**
 * API SEARCH DATA PROVIDER — Prompt 13 (real backend wiring).
 *
 * Implements the existing `SearchDataProvider` seam (see provider.ts) plus
 * the Fix-lifecycle calls the product needs, against the real NestJS API
 * (see docs/backend-architecture.md §12). The backend remains the source of
 * truth for recommendation, evidence, Fix state, measurement state, and
 * outcome — this module performs no business logic, only transport,
 * CSRF handling, error mapping, and shape adaptation.
 *
 * Wired endpoints (all under API_BASE, default http://localhost:3000/api/v1):
 *   GET  /auth/me                                            → session + workspaces
 *   GET  /auth/csrf                                          → { csrfToken } (memory only)
 *   GET  /workspaces/:wid/properties                         → SearchProperty[]
 *   GET  /workspaces/:wid/properties/:pid/snapshot           → SearchPerformanceSnapshot
 *   GET  /workspaces/:wid/properties/:pid/recommendation     → RecommendationResult
 *   GET  /workspaces/:wid/properties/:pid/fix                → current Fix (or null)
 *   POST /workspaces/:wid/properties/:pid/fix/:fid/review    → Fix
 *   POST /workspaces/:wid/properties/:pid/fix/:fid/apply     → Fix (+baseline)
 *   POST /workspaces/:wid/properties/:pid/fix/:fid/dismiss   → Fix (body: { reason })
 *   POST /workspaces/:wid/properties/:pid/fix/:fid/acknowledge → { ok: true }
 *   POST /workspaces/:wid/properties/:pid/fix/:fid/check     → measurement result
 *
 * Security rules enforced here:
 * - Every request uses `credentials: "include"` (httpOnly session cookie).
 * - State-changing requests send `x-csrf-token` (token kept in module
 *   memory only — never localStorage, never logged).
 * - This module never reads or writes localStorage, and never expects
 *   Google access/refresh tokens or session ids in any response.
 * - Backend `siteUrl` values are dropped at the mapping boundary; the
 *   frontend only ever handles opaque property ids.
 */

import type { SearchDataProvider } from "./provider.ts";
import type {
  Recommendation,
  RecommendationResult,
  RecommendationResultStatus,
  SearchPerformanceSnapshot,
  SearchPeriod,
  SearchProperty,
} from "./types.ts";
import type { DataError, DataErrorCode, Result } from "./errors.ts";
import { dataError, err, ok } from "./errors.ts";
import type { FixOutcome, FixStatus, HistoryItem, ProductFix } from "../mock/types.ts";
import type { SearchConsoleProperty } from "../mock/types.ts";
import { MEASUREMENT_WINDOW_DAYS } from "../mock/product-service.ts";
import { recommendationToProductFix } from "./adapters.ts";
import { addDays, nowIso } from "./dates.ts";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3000/api/v1").replace(/\/+$/, "");

/** Base URL for building backend links (e.g. the OAuth redirect entry point). */
export function getApiBase(): string {
  return API_BASE;
}

/* ------------------------------------------------------------------ */
/* Error mapping (Prompt 13 §4)                                        */
/* ------------------------------------------------------------------ */

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "PROPERTY_NOT_FOUND",
  "NO_DATA",
  "INSUFFICIENT_DATA",
  "STALE_DATA",
  "PARTIAL_DATA",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "UNKNOWN_ERROR",
]);

function isKnownCode(code: unknown): code is DataErrorCode {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

/**
 * Thrown error shape: the normalized `DataError` plus the raw backend
 * code when it isn't part of the frozen `DataErrorCode` union (e.g.
 * `EMAIL_EXISTS`, `INVALID_CREDENTIALS`). Lets auth forms distinguish
 * cases the shared contract doesn't enumerate, without widening it.
 */
export interface ApiError extends DataError {
  rawCode?: string;
}

/** Extracts a backend error code from the shapes NestJS may produce (any string code, known or not). */
export function extractErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const direct = record.error;
  if (direct && typeof direct === "object") {
    const code = (direct as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  if (typeof record.code === "string") return record.code;
  // Nest serializes `throw new ForbiddenException({code, message})` as
  // `{ message: { code, message }, error, statusCode }`.
  const message = record.message;
  if (message && typeof message === "object") {
    const code = (message as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const direct = record.error;
    if (direct && typeof direct === "object") {
      const message = (direct as Record<string, unknown>).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
    if (typeof record.message === "string" && record.message.length > 0) return record.message;
    const nested = record.message;
    if (nested && typeof nested === "object" && typeof (nested as Record<string, unknown>).message === "string") {
      return (nested as Record<string, unknown>).message as string;
    }
  }
  return fallback;
}

/**
 * Maps an HTTP failure into the existing frontend `DataError` model.
 * Never invents success: transport/auth/permission/rate-limit failures
 * become typed errors the UI renders honestly (never "No Fix").
 */
export function mapApiError(httpStatus: number, body: unknown): ApiError {
  const code = extractErrorCode(body);
  if (code && isKnownCode(code)) {
    return dataError(code, extractMessage(body, "Something went wrong."));
  }
  const withRaw = (error: DataError): ApiError => (code ? { ...error, rawCode: code } : error);
  switch (httpStatus) {
    case 401:
      return withRaw(dataError("AUTH_REQUIRED", extractMessage(body, "Sign in again to continue.")));
    case 403:
      return withRaw(
        dataError(
          "PERMISSION_DENIED",
          extractMessage(body, "You don't have access to this workspace. Check back after the workspace owner grants access."),
        ),
      );
    case 404: {
      // The snapshot endpoint reports a missing snapshot as
      // DATA_UNAVAILABLE — "no data yet", not a missing property.
      const raw = body && typeof body === "object" ? (body as Record<string, unknown>).code : null;
      if (raw === "DATA_UNAVAILABLE") {
        return withRaw(dataError("NO_DATA", extractMessage(body, "No Search Console data for this period yet.")));
      }
      return withRaw(
        dataError(
          "PROPERTY_NOT_FOUND",
          extractMessage(body, "We couldn't find that property in this workspace."),
        ),
      );
    }
    case 429:
      return withRaw(
        dataError(
          "RATE_LIMITED",
          extractMessage(body, "RENKO hit a rate limit. Try again shortly."),
        ),
      );
    case 502:
    case 503:
    case 504:
      return withRaw(
        dataError(
          "UPSTREAM_ERROR",
          extractMessage(body, "RENKO couldn't reach Search Console for this property right now."),
        ),
      );
    default:
      return withRaw(dataError("UNKNOWN_ERROR", extractMessage(body, "Something went wrong.")));
  }
}

/* ------------------------------------------------------------------ */
/* Transport (credentials + CSRF)                                      */
/* ------------------------------------------------------------------ */

async function readBody(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

/**
 * GET/transport helper. Always sends `credentials: "include"` so the
 * httpOnly session cookie (`renko.sid`) is attached. Throws a mapped
 * `DataError` on HTTP failure — never a raw Response or stack.
 */
export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // Transport failure (offline, DNS, refused): a connection problem,
    // distinct from "no recommendation".
    throw dataError("UPSTREAM_ERROR", "RENKO couldn't reach the API. Check your connection and try again.");
  }
  if (!res.ok) {
    throw mapApiError(res.status, await readBody(res));
  }
  return (await readBody(res)) as T;
}

/** CSRF token cache — module memory only. Never localStorage. */
let csrfToken: string | null = null;

export function resetCsrfToken(): void {
  csrfToken = null;
}

export async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const data = await fetchJson<{ csrfToken: string }>("/auth/csrf", { credentials: "include" });
  if (!data || typeof data.csrfToken !== "string" || data.csrfToken.length === 0) {
    throw dataError("UNKNOWN_ERROR", "Something went wrong.");
  }
  csrfToken = data.csrfToken;
  return csrfToken;
}

function isCsrfFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  if (record.code === "PERMISSION_DENIED") {
    const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
    return message.includes("csrf");
  }
  return false;
}

/**
 * Authenticated state-changing request. Sends `x-csrf-token`; on an
 * expired/invalid token it refreshes once and retries, then surfaces a
 * mapped `DataError` (never a session id, never a token).
 */
export async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await ensureCsrfToken();
  try {
    return await fetchJson<T>(path, {
      ...init,
      headers: {
        "x-csrf-token": token,
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    if (isCsrfFailure(error)) {
      resetCsrfToken();
      const retryToken = await ensureCsrfToken();
      return fetchJson<T>(path, {
        ...init,
        headers: {
          "x-csrf-token": retryToken,
          ...(init.headers ?? {}),
        },
      });
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Session / workspace context (Prompt 13 §7)                          */
/*                                                                     */
/* The workspaceId ALWAYS comes from the authenticated                 */
/* `GET /auth/me` response — never from client localStorage. Every     */
/* data request is scoped to that workspace and the backend re-checks  */
/* membership + property ownership server-side. Editing ids in the     */
/* browser cannot bypass isolation (backend returns 403/404).          */
/* ------------------------------------------------------------------ */

export interface ApiSessionUser {
  id: string;
  email: string;
}

export interface ApiSessionWorkspace {
  id: string;
  name: string;
  plan: string;
}

export interface ApiSession {
  user: ApiSessionUser;
  workspaces: ApiSessionWorkspace[];
}

export async function fetchSessionContext(): Promise<ApiSession> {
  return fetchJson<ApiSession>("/auth/me", { credentials: "include" });
}

/* ------------------------------------------------------------------ */
/* Backend shapes (transport only — no business logic)                 */
/* ------------------------------------------------------------------ */

export interface BackendRecommendation {
  id: string;
  page: string;
  signal: string;
  finding: string;
  interpretation: string;
  recommendedAction: string;
  rationale: string;
  snapshot: SearchPerformanceSnapshot;
  evidence: Recommendation["evidence"];
  limitations: string[];
}

interface BackendRecommendationResponse {
  status: RecommendationResultStatus;
  recommendation?: BackendRecommendation;
  meta?: RecommendationResult["meta"];
}

interface BackendFixPayload {
  id: string;
  page: string;
  status: string;
  dismissReason?: string | null;
  baseline?: { clicks: number; ctr: string; position: number; capturedAt: string } | null;
  appliedAt?: string | null;
  expectedMeasurementDate?: string | null;
  measurementWindowDays?: number | null;
  outcome?: {
    status: string;
    before?: { clicks: number; ctr: string; position: number };
    beforeJson?: { clicks: number; ctr: string; position: number };
    after?: { clicks: number; ctr: string; position: number } | null;
    afterJson?: { clicks: number; ctr: string; position: number } | null;
    measuredAt?: string | null;
  } | null;
  recommendation?: BackendRecommendation | null;
}

export interface BackendCheckResult {
  status: string;
  message?: string;
  outcome?: BackendFixPayload["outcome"];
}

const OUTCOME_STATUS_MAP: Record<string, FixOutcome["status"]> = {
  "positive-change": "positive-change",
  positive_change: "positive-change",
  "no-material-change": "no-material-change",
  no_material_change: "no-material-change",
  "negative-change": "negative-change",
  negative_change: "negative-change",
  "insufficient-data": "insufficient-data",
  insufficient_data: "insufficient-data",
  "data-delayed": "data-delayed",
  data_delayed: "data-delayed",
  "conflicting-data": "conflicting-data",
  conflicting_data: "conflicting-data",
  unavailable: "unavailable",
};

export function mapBackendOutcomeStatus(status: string): FixOutcome["status"] {
  return OUTCOME_STATUS_MAP[status] ?? "unavailable";
}

export function mapBackendOutcome(outcome: NonNullable<BackendFixPayload["outcome"]>): FixOutcome {
  const before = outcome.before ?? outcome.beforeJson ?? { clicks: 0, ctr: "0.0%", position: 0 };
  const afterRaw = outcome.after ?? outcome.afterJson ?? undefined;
  return {
    status: mapBackendOutcomeStatus(outcome.status),
    before: { clicks: before.clicks, ctr: before.ctr, position: before.position },
    ...(afterRaw ? { after: { clicks: afterRaw.clicks, ctr: afterRaw.ctr, position: afterRaw.position } } : {}),
    ...(outcome.measuredAt ? { measuredAt: outcome.measuredAt } : {}),
  };
}

function toRecommendation(payload: BackendRecommendation): Recommendation {
  return {
    id: payload.id,
    page: payload.page,
    signal: payload.signal as Recommendation["signal"],
    finding: payload.finding,
    interpretation: payload.interpretation,
    recommendedAction: payload.recommendedAction,
    rationale: payload.rationale,
    snapshot: payload.snapshot,
    evidence: payload.evidence,
    limitations: payload.limitations,
  };
}

/**
 * Builds the UI-facing `ProductFix` from the backend Fix + its
 * Recommendation. Evidence/provenance come from the backend snapshot;
 * display formatting reuses the existing adapter (no duplicated logic).
 */
export function mapBackendFixToProductFix(
  fix: BackendFixPayload,
  recommendation: BackendRecommendation | null,
): ProductFix | null {
  if (!recommendation) return null;
  const windowDays = fix.measurementWindowDays ?? MEASUREMENT_WINDOW_DAYS;
  const base = recommendationToProductFix(toRecommendation(recommendation), windowDays);
  return overlayFixLifecycle(base, fix);
}

/** Overlays backend lifecycle fields onto an existing ProductFix. */
export function overlayFixLifecycle(prev: ProductFix, fix: BackendFixPayload): ProductFix {
  const baseline = fix.baseline
    ? {
        clicks: fix.baseline.clicks,
        ctr: fix.baseline.ctr,
        position: fix.baseline.position,
        capturedAt: fix.baseline.capturedAt,
      }
    : prev.baseline;
  return {
    ...prev,
    id: fix.id,
    page: fix.page,
    status: (fix.status as FixStatus) ?? prev.status,
    ...(fix.dismissReason ? { dismissReason: fix.dismissReason as ProductFix["dismissReason"] } : {}),
    ...(baseline ? { baseline } : {}),
    ...(fix.appliedAt ? { appliedAt: fix.appliedAt } : {}),
    ...(fix.expectedMeasurementDate ? { expectedMeasurementDate: fix.expectedMeasurementDate } : {}),
    measurementWindowDays: fix.measurementWindowDays ?? prev.measurementWindowDays,
    ...(fix.outcome ? { outcome: mapBackendOutcome(fix.outcome) } : {}),
  };
}

function mapBackendPropertyType(type: string): SearchProperty["type"] {
  return type === "url-prefix" || type === "url_prefix" ? "url-prefix" : "domain";
}

function mapBackendPropertyStatus(status: string): SearchConsoleProperty["status"] {
  switch (status) {
    case "needs-attention":
    case "needs_attention":
      return "needs-attention";
    case "stale":
      return "stale";
    case "disconnected":
      return "disconnected";
    case "healthy":
    default:
      return "healthy";
  }
}

interface BackendPropertyRow {
  id: string;
  name?: string;
  displayName?: string;
  type: string;
  status?: string;
  isSelectable?: boolean;
  selectable?: boolean;
}

/** Maps backend property rows; drops internal `siteUrl` at the boundary. */
export function mapBackendProperties(rows: BackendPropertyRow[]): SearchConsoleProperty[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? row.displayName ?? row.id,
    type: mapBackendPropertyType(row.type),
    status: mapBackendPropertyStatus(row.status ?? "healthy"),
    selectable: row.isSelectable ?? row.selectable ?? true,
  }));
}

function toSearchProperties(rows: SearchConsoleProperty[]): SearchProperty[] {
  return rows.map((row) => ({ id: row.id, name: row.name, type: row.type }));
}

/* ------------------------------------------------------------------ */
/* Real provider factory                                               */
/* ------------------------------------------------------------------ */

export interface ApiFixClient {
  getFix(propertyId: string): Promise<{ fix: ProductFix | null; recommendation: BackendRecommendation | null }>;
  reviewFix(propertyId: string, fixId: string): Promise<void>;
  applyFix(propertyId: string, fixId: string): Promise<void>;
  dismissFix(propertyId: string, fixId: string, reason: string): Promise<void>;
  acknowledgeFix(propertyId: string, fixId: string): Promise<void>;
  checkFix(propertyId: string, fixId: string): Promise<BackendCheckResult>;
  listProperties(): Promise<SearchConsoleProperty[]>;
  triggerIngest(propertyId: string): Promise<{ jobId?: string; queued: boolean }>;
  listHistory(options?: { limit?: number; offset?: number }): Promise<{ items: HistoryItem[]; total: number }>;
  getHistoryDetail(fixId: string): Promise<HistoryItem>;
}

function workspacePath(workspaceId: string, rest: string): string {
  return `/workspaces/${encodeURIComponent(workspaceId)}/properties/${rest
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/**
 * Creates a workspace-scoped real provider. The `workspaceId` must come
 * from `fetchSessionContext()` (the authenticated session), never from
 * client storage — see session-context real mode.
 */
export function createApiProvider(workspaceId: string): SearchDataProvider & ApiFixClient {
  async function getRecommendationResult(propertyId: string): Promise<RecommendationResult> {
    const body = await fetchJson<BackendRecommendationResponse>(
      workspacePath(workspaceId, `${propertyId}/recommendation`),
      { credentials: "include" },
    );
    if (body.status === "recommendation-available" && body.recommendation) {
      return {
        status: body.status,
        recommendation: toRecommendation(body.recommendation),
        ...(body.meta ? { meta: body.meta } : {}),
      };
    }
    // Honest empty states pass through untouched — never fabricate,
    // never collapse into "No Fix".
    return {
      status: body.status,
      ...(body.recommendation ? { recommendation: toRecommendation(body.recommendation) } : {}),
      ...(body.meta ? { meta: body.meta } : {}),
    };
  }

  async function getPerformanceSnapshot(
    propertyId: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _period?: SearchPeriod,
  ): Promise<Result<SearchPerformanceSnapshot, DataError>> {
    try {
      const body = await fetchJson<{ snapshot: SearchPerformanceSnapshot }>(
        workspacePath(workspaceId, `${propertyId}/snapshot`),
        { credentials: "include" },
      );
      if (!body || !body.snapshot) {
        return err(dataError("NO_DATA", "No Search Console data for this period."));
      }
      return ok(body.snapshot);
    } catch (error) {
      if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
        const dataErrorValue = error as DataError;
        // A missing snapshot is "no data yet" — not a crash.
        if (dataErrorValue.code === "PROPERTY_NOT_FOUND") return err(dataErrorValue);
        return err(dataErrorValue);
      }
      return err(dataError("UNKNOWN_ERROR", "Something went wrong."));
    }
  }

  async function getProperties(): Promise<Result<SearchProperty[], DataError>> {
    try {
      const rows = await listProperties();
      return ok(toSearchProperties(rows));
    } catch (error) {
      if (error && typeof error === "object" && "code" in (error as Record<string, unknown>)) {
        return err(error as DataError);
      }
      return err(dataError("UNKNOWN_ERROR", "Something went wrong."));
    }
  }

  async function listProperties(): Promise<SearchConsoleProperty[]> {
    const body = await fetchJson<{ properties: BackendPropertyRow[] }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/properties`,
      { credentials: "include" },
    );
    return mapBackendProperties(body.properties ?? []);
  }

  async function getFix(
    propertyId: string,
  ): Promise<{ fix: ProductFix | null; recommendation: BackendRecommendation | null }> {
    const body = await fetchJson<{ fix: BackendFixPayload | null }>(
      workspacePath(workspaceId, `${propertyId}/fix`),
      { credentials: "include" },
    );
    if (!body || !body.fix) return { fix: null, recommendation: null };
    const recommendation = body.fix.recommendation ?? null;
    return { fix: mapBackendFixToProductFix(body.fix, recommendation), recommendation };
  }

  async function reviewFix(propertyId: string, fixId: string): Promise<void> {
    await authFetch<{ fix: BackendFixPayload }>(workspacePath(workspaceId, `${propertyId}/fix/${fixId}/review`), {
      method: "POST",
      credentials: "include",
    });
  }

  async function applyFix(propertyId: string, fixId: string): Promise<void> {
    await authFetch<{ fix: BackendFixPayload }>(workspacePath(workspaceId, `${propertyId}/fix/${fixId}/apply`), {
      method: "POST",
      credentials: "include",
    });
  }

  async function dismissFix(propertyId: string, fixId: string, reason: string): Promise<void> {
    await authFetch<{ fix: BackendFixPayload }>(workspacePath(workspaceId, `${propertyId}/fix/${fixId}/dismiss`), {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ reason }),
    });
  }

  async function acknowledgeFix(propertyId: string, fixId: string): Promise<void> {
    await authFetch<{ ok: boolean }>(workspacePath(workspaceId, `${propertyId}/fix/${fixId}/acknowledge`), {
      method: "POST",
      credentials: "include",
    });
  }

  async function checkFix(propertyId: string, fixId: string): Promise<BackendCheckResult> {
    return authFetch<BackendCheckResult>(workspacePath(workspaceId, `${propertyId}/fix/${fixId}/check`), {
      method: "POST",
      credentials: "include",
    });
  }

  async function triggerIngest(propertyId: string): Promise<{ jobId?: string; queued: boolean }> {
    return authFetch<{ jobId?: string; queued: boolean }>(workspacePath(workspaceId, `${propertyId}/ingest`), {
      method: "POST",
      credentials: "include",
    });
  }

  async function listHistory(options?: { limit?: number; offset?: number }): Promise<{ items: HistoryItem[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set("limit", String(options.limit));
    if (options?.offset !== undefined) params.set("offset", String(options.offset));
    const query = params.toString();
    const body = await fetchJson<{ items: BackendHistoryItem[]; total: number }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/history${query ? `?${query}` : ""}`,
      { credentials: "include" },
    );
    const items: HistoryItem[] = [];
    for (const raw of body.items ?? []) {
      const mapped = mapBackendHistoryItem(raw);
      if (mapped) items.push(mapped);
    }
    return { items, total: typeof body.total === "number" ? body.total : items.length };
  }

  async function getHistoryDetail(fixId: string): Promise<HistoryItem> {
    const body = await fetchJson<{ item: BackendHistoryItem }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/history/${encodeURIComponent(fixId)}`,
      { credentials: "include" },
    );
    const mapped = body?.item ? mapBackendHistoryItem(body.item) : null;
    if (!mapped) {
      throw dataError("PROPERTY_NOT_FOUND", "We couldn't find that history item in this workspace.");
    }
    return mapped;
  }

  return {
    getProperties,
    getPerformanceSnapshot,
    getRecommendationResult,
    getFix,
    reviewFix,
    applyFix,
    dismissFix,
    acknowledgeFix,
    checkFix,
    listProperties,
    triggerIngest,
    listHistory,
    getHistoryDetail,
  };
}

/**
 * Back-compat singleton surface (used only where a workspace is not yet
 * known, e.g. CSRF warmup). Product code must use `createApiProvider`
 * with the session workspace — never this alone for data calls.
 */
export const ApiSearchDataProvider: SearchDataProvider = {
  async getProperties(): Promise<Result<SearchProperty[], DataError>> {
    return err(
      dataError(
        "AUTH_REQUIRED",
        "Sign in again to continue. The real provider needs an authenticated workspace before it can list properties.",
      ),
    );
  },

  async getPerformanceSnapshot(): Promise<Result<SearchPerformanceSnapshot, DataError>> {
    return err(
      dataError(
        "AUTH_REQUIRED",
        "Sign in again to continue. The real provider needs an authenticated workspace before it can load data.",
      ),
    );
  },

  async getRecommendationResult(): Promise<RecommendationResult> {
    return { status: "unavailable", meta: undefined };
  },
};

/* ------------------------------------------------------------------ */
/* Auth (Prompt: real signup/login/logout — thin transport only)       */
/*                                                                     */
/* The server session (httpOnly cookie) is the authentication source   */
/* of truth. Nothing here stores session ids or tokens — responses are */
/* limited to `{user, workspace(s)}` and any token fields the backend  */
/* might ever include are dropped by the mappers below.                */
/* ------------------------------------------------------------------ */

export interface ApiAuthResult {
  user: ApiSessionUser;
  workspace?: ApiSessionWorkspace;
  workspaces?: ApiSessionWorkspace[];
}

export async function signUpApi(email: string, password: string, workspaceName?: string): Promise<ApiAuthResult> {
  const body = await fetchJson<{ user: ApiSessionUser; workspace: ApiSessionWorkspace }>("/auth/sign-up", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ email, password, ...(workspaceName ? { workspaceName } : {}) }),
  });
  return { user: body.user, workspace: body.workspace };
}

export async function logInApi(email: string, password: string): Promise<ApiAuthResult> {
  const body = await fetchJson<{ user: ApiSessionUser; workspaces: ApiSessionWorkspace[] }>("/auth/log-in", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  return { user: body.user, workspaces: body.workspaces };
}

export async function logOutApi(): Promise<void> {
  await authFetch<{ ok: boolean }>("/auth/log-out", { method: "POST", credentials: "include" });
}

export async function createWorkspaceApi(name: string): Promise<ApiSessionWorkspace> {
  const body = await authFetch<{ workspace: ApiSessionWorkspace }>("/workspaces", {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  return body.workspace;
}

export type AuthFormErrorCode = "email-exists" | "invalid-credentials" | "rate-limited" | "network-failure" | "server-error";

/**
 * Maps a transport error to the auth forms' existing error model
 * (mirrors `mockAuthService` codes so screens don't change).
 */
export function mapAuthErrorToForm(error: unknown): { errorCode: AuthFormErrorCode; message: string } {
  const record = error && typeof error === "object" ? (error as { code?: unknown; rawCode?: unknown; message?: unknown }) : null;
  // Prefer the raw backend code — the shared DataError union doesn't
  // enumerate auth-specific cases like EMAIL_EXISTS.
  const code = record?.rawCode ?? record?.code ?? null;
  const message = typeof record?.message === "string" ? (record.message as string) : "";
  if (code === "EMAIL_EXISTS") {
    return { errorCode: "email-exists", message: message || "This email is already registered. Log in instead." };
  }
  if (code === "AUTH_REQUIRED" || code === "INVALID_CREDENTIALS") {
    return { errorCode: "invalid-credentials", message: message || "Those credentials don't match our records." };
  }
  if (code === "RATE_LIMITED") {
    return { errorCode: "rate-limited", message: message || "Too many attempts. Wait a few minutes and try again." };
  }
  if (code === "UPSTREAM_ERROR") {
    return { errorCode: "network-failure", message: message || "We couldn't reach RENKO. Check your connection and try again." };
  }
  return { errorCode: "server-error", message: message || "Something went wrong. Try again." };
}

export interface ConnectionStatus {
  connected: boolean;
  status: string | null;
  googleAccountEmail: string | null;
}

export async function fetchConnectionStatus(workspaceId: string): Promise<ConnectionStatus> {
  const body = await fetchJson<{ connected: boolean; status: string | null; googleAccountEmail: string | null }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/connections/status`,
    { credentials: "include" },
  );
  return { connected: body.connected === true, status: body.status ?? null, googleAccountEmail: body.googleAccountEmail ?? null };
}

/* ------------------------------------------------------------------ */
/* History (Prompt: backend is the source of truth in real mode)       */
/* ------------------------------------------------------------------ */

export interface BackendHistoryItem {
  id: string;
  propertyId: string;
  propertyName?: string;
  fix: Record<string, unknown>;
  page: string;
  recommendedChange: string;
  status: string;
  appliedAt: string | null;
  dismissReason?: string;
  outcome?: BackendFixPayload["outcome"] & { status: string };
}

function isHistoryStatus(status: string): status is HistoryItem["status"] {
  return status === "measured" || status === "waiting" || status === "dismissed";
}

function isValidProductFixShape(fix: Record<string, unknown>): boolean {
  return (
    typeof fix.id === "string" &&
    typeof fix.page === "string" &&
    typeof fix.clicks === "number" &&
    typeof fix.impressions === "number" &&
    typeof fix.ctr === "string" &&
    typeof fix.position === "number" &&
    typeof fix.finding === "string" &&
    typeof fix.recommendedChange === "string" &&
    typeof fix.evidence === "object" &&
    fix.evidence !== null &&
    typeof fix.dataMeta === "object" &&
    fix.dataMeta !== null
  );
}

/**
 * Validates a backend history item into the frontend `HistoryItem` shape.
 * Returns null for malformed rows (the list caller drops them; the detail
 * caller converts to a 404-style error). Outcome statuses reuse the
 * existing underscore→dash mapper.
 */
export function mapBackendHistoryItem(raw: BackendHistoryItem): HistoryItem | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.page !== "string") return null;
  if (!isHistoryStatus(raw.status)) return null;
  if (!raw.fix || typeof raw.fix !== "object" || !isValidProductFixShape(raw.fix)) return null;
  const outcome = raw.outcome
    ? mapBackendOutcome(raw.outcome as NonNullable<BackendFixPayload["outcome"]>)
    : undefined;
  return {
    id: raw.id,
    fix: raw.fix as unknown as HistoryItem["fix"],
    page: raw.page,
    recommendedChange: typeof raw.recommendedChange === "string" ? raw.recommendedChange : "",
    status: raw.status,
    appliedAt: raw.appliedAt,
    ...(typeof raw.dismissReason === "string" ? { dismissReason: raw.dismissReason as HistoryItem["dismissReason"] } : {}),
    ...(outcome ? { outcome } : {}),
  };
}

// Helpers exposed for tests/migration. `nowIso`/`addDays` are re-exported
// so real-mode state builders share the same clock helpers.
export const _internal = {
  ensureCsrfToken,
  resetCsrfToken,
  authFetch,
  fetchJson,
  mapApiError,
  extractErrorCode,
  API_BASE,
  nowIso,
  addDays,
};
