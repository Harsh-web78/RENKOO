/**
 * REAL-MODE STATE HELPERS — Prompt 13 (pure, UI-framework-free).
 *
 * These are the only place real-backend payloads become the product's
 * per-property view state. They are deliberately pure functions so they
 * can be unit-tested without React, and so the `.tsx` session layer stays
 * a thin async shell around them.
 *
 * Rules enforced here:
 * - A recommendation is only ever shown when the backend returned one for
 *   the *currently selected* property. Switching properties discards all
 *   cached recommendation/fix state first (see
 *   `discardStateForPropertySwitch`) — the new property never sees the
 *   previous property's recommendation, even briefly.
 * - Auth/permission/rate-limit errors are NOT collapsed into a NoFixReason
 *   (they need distinct UX); `dataErrorToNoFixReason` returns `null` for
 *   them so callers render the error panel instead of `EmptyFixState`.
 * - `measurement_pending` never fabricates an outcome — it yields a
 *   pending notice with honest copy.
 * - Client storage holds at most the selected property *pointer* (a UI
 *   preference). Workspace identity always comes from the authenticated
 *   session; the pointer is validated against the authorized property
 *   list on every load.
 */

import type { DataError } from "./errors.ts";
import type { Recommendation, RecommendationResult } from "./types.ts";
import type { BackendCheckResult, BackendRecommendation } from "./api-provider.ts";
import { recommendationResultStatusToNoFixReason, recommendationToProductFix } from "./adapters.ts";
import { formatCtr } from "./mock-provider.ts";
import { MEASUREMENT_WINDOW_DAYS } from "../mock/product-service.ts";
import { addDays, nowIso } from "./dates.ts";
import type {
  FixRecommendation,
  HistoryItem,
  NoFixReason,
  ProductFix,
  PropertyProductState,
} from "../mock/types.ts";

/** Exact pending copy required by Prompt 13 §5 (also used as fallback). */
export const MEASUREMENT_PENDING_COPY = "Check back after 14-day window.";

export const REAL_PROPERTY_POINTER_KEY = "renko-real-property-v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    if (!window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the selected-property pointer. Never workspace/auth data. */
export function readRealPropertyPointer(storage: StorageLike | null = defaultStorage()): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(REAL_PROPERTY_POINTER_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/** Persists only the selected-property pointer. Never workspace/auth data. */
export function writeRealPropertyPointer(propertyId: string | null, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (propertyId) storage.setItem(REAL_PROPERTY_POINTER_KEY, propertyId);
    else storage.removeItem(REAL_PROPERTY_POINTER_KEY);
  } catch {
    // Best-effort only — pointer loss just means "no pre-selection".
  }
}

/**
 * Maps a transport error to an honest empty-state reason, or `null` when
 * the error needs its own error UX (auth / permission / rate-limit /
 * not-found must never render as "No Fix").
 */
export function dataErrorToNoFixReason(error: DataError): NoFixReason | null {
  switch (error.code) {
    case "INSUFFICIENT_DATA":
      return "insufficient-data";
    case "STALE_DATA":
      return "stale-data";
    case "NO_DATA":
    case "PARTIAL_DATA":
    case "UPSTREAM_ERROR":
    case "UNKNOWN_ERROR":
      return "connection-error";
    case "AUTH_REQUIRED":
    case "PERMISSION_DENIED":
    case "PROPERTY_NOT_FOUND":
    case "RATE_LIMITED":
    default:
      return null;
  }
}

/** Honest empty placeholder used before the backend responds (never rendered as content while loading). */
export function initialRealPropertyState(now: string = nowIso()): PropertyProductState {
  return {
    currentFix: null,
    history: [],
    noFixReason: "no-fix",
    lastCheckedAt: now,
    nextCheckAt: addDays(now, 7),
    lastSuccessfulDataAt: now,
  };
}

export interface RealPropertyAssembly {
  recommendationResult: RecommendationResult;
  /** Current Fix already mapped to a ProductFix (null when the backend has none). */
  fix: ProductFix | null;
  /** Backend recommendation payload when the Fix row carries none (keeps Home showing the ONE recommendation). */
  recommendation: BackendRecommendation | null;
  /** Session-local history (backend exposes no history endpoint yet — see docs/prompt-13-history-limitation.md). */
  localHistory: HistoryItem[];
  now?: string;
}

/**
 * Assembles per-property view state from backend truth. The Fix (with its
 * embedded recommendation/evidence) wins; a bare recommendation is
 * adapted so Home still shows the backend's ONE recommendation; honest
 * empty statuses map to their NoFixReason without fabrication.
 */
export function applyRecommendationAndFix(assembly: RealPropertyAssembly): PropertyProductState {
  const now = assembly.now ?? nowIso();
  const { recommendationResult, fix, recommendation, localHistory } = assembly;

  if (fix) {
    return {
      currentFix: fix,
      history: localHistory,
      noFixReason: "no-fix",
      lastCheckedAt: now,
      nextCheckAt: addDays(now, 7),
      lastSuccessfulDataAt: fix.dataMeta.dataThrough,
    };
  }

  const payload = recommendationResult.recommendation ?? recommendation;
  if (recommendationResult.status === "recommendation-available" && payload) {
    const currentFix: ProductFix = recommendationToProductFix(
      {
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
      },
      MEASUREMENT_WINDOW_DAYS,
    );
    return {
      currentFix,
      history: localHistory,
      noFixReason: "no-fix",
      lastCheckedAt: now,
      nextCheckAt: addDays(now, 7),
      lastSuccessfulDataAt: payload.snapshot.meta.dataThrough,
    };
  }

  const noFixReason = recommendationResultStatusToNoFixReason(recommendationResult.status);
  return {
    currentFix: null,
    history: localHistory,
    noFixReason,
    lastCheckedAt: now,
    nextCheckAt: addDays(now, 7),
    lastSuccessfulDataAt: recommendationResult.meta?.dataThrough ?? now,
  };
}

export interface PropertySwitchSnapshot {
  states: Record<string, PropertyProductState>;
  statuses: Record<string, "loading" | "ready" | "error">;
  errors: Record<string, DataError | null>;
  notices: Record<string, string | null>;
}

/**
 * Property-switch isolation: drops every cached recommendation/fix,
 * status, error, and pending notice so the newly selected property can
 * never render the previous property's data — even for one frame. The
 * caller re-fetches for the new property immediately after.
 */
export function discardStateForPropertySwitch(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _snapshot: PropertySwitchSnapshot,
): PropertySwitchSnapshot {
  return { states: {}, statuses: {}, errors: {}, notices: {} };
}

export type HomeViewKind =
  | "session-loading"
  | "session-error"
  | "no-property"
  | "property-loading"
  | "property-error"
  | "fix"
  | "empty";

export interface HomeViewInput {
  sessionLoaded: boolean;
  sessionError: DataError | null;
  propertyId: string | null;
  propertyStatus: "loading" | "ready" | "error" | null;
  propertyError: DataError | null;
  state: PropertyProductState | null;
}

export interface HomeView {
  kind: HomeViewKind;
  state: PropertyProductState | null;
  error: DataError | null;
}

/**
 * Pure view-model behind Home/Fixes in real mode: decides loading vs
 * error vs fix vs honest-empty. Tested directly (component shells are
 * thin branches over this).
 */
export function resolveHomeView(input: HomeViewInput): HomeView {
  if (!input.sessionLoaded) return { kind: "session-loading", state: null, error: null };
  if (input.sessionError) return { kind: "session-error", state: null, error: input.sessionError };
  if (!input.propertyId) return { kind: "no-property", state: null, error: null };
  if (input.propertyStatus !== "ready") {
    if (input.propertyStatus === "error") {
      return { kind: "property-error", state: input.state, error: input.propertyError };
    }
    return { kind: "property-loading", state: null, error: null };
  }
  if (input.propertyError) return { kind: "property-error", state: input.state, error: input.propertyError };
  if (input.state?.currentFix) return { kind: "fix", state: input.state, error: null };
  return { kind: "empty", state: input.state, error: null };
}

export function isMeasurementPending(result: BackendCheckResult): boolean {
  return result.status === "measurement_pending";
}

/** Honest pending notice: prefers the backend message, normalized to the required copy. */
export function pendingNoticeFor(result: BackendCheckResult): string {
  const message = (result.message ?? "").trim();
  if (!message) return `Measurement window not yet reached — ${MEASUREMENT_PENDING_COPY}`;
  // The backend sends "...check back after the 14-day window." — normalize
  // any case/"the" variant of that clause to the exact required copy.
  const normalized = message.replace(/check back after (?:the )?14-day window\.?/i, MEASUREMENT_PENDING_COPY);
  if (normalized !== message) return normalized;
  if (message.includes(MEASUREMENT_PENDING_COPY)) return message;
  return `${message} ${MEASUREMENT_PENDING_COPY}`;
}

/* ------------------------------------------------------------------ */
/* History view-model (Prompt: backend is the source of truth)         */
/* ------------------------------------------------------------------ */

export type HistoryViewKind = "loading" | "error" | "empty" | "list";

export interface HistoryView {
  kind: HistoryViewKind;
  items: HistoryItem[];
  error: DataError | null;
}

/** Pure view-model behind HistoryContent in real mode. */
export function resolveHistoryView(
  status: "loading" | "ready" | "error",
  error: DataError | null,
  items: HistoryItem[],
): HistoryView {
  if (status === "loading") return { kind: "loading", items: [], error: null };
  if (status === "error") return { kind: "error", items: [], error };
  if (items.length === 0) return { kind: "empty", items: [], error: null };
  return { kind: "list", items, error: null };
}

/** Backend history is workspace-scoped; product screens stay property-scoped. */
export function filterHistoryByProperty(history: HistoryItem[], propertyId: string): HistoryItem[] {
  // Backend HistoryItems carry the full ProductFix whose dataMeta.property.id
  // is the authoritative property — never a client-supplied id.
  return history.filter((item) => item.fix?.dataMeta?.property?.id === propertyId);
}

/* ------------------------------------------------------------------ */
/* Onboarding bridge (Prompt: real analyzing → real recommendation)    */
/*                                                                     */
/* Reshapes the backend's Recommendation into the onboarding First Fix */
/* display shape. No new facts: metrics, finding, action, rationale,   */
/* and evidence rows all come from the backend snapshot.               */
/* ------------------------------------------------------------------ */

export function backendRecommendationToOnboardingFix(recommendation: BackendRecommendation): FixRecommendation {
  const page = recommendation.snapshot.page;
  const comparison = recommendation.snapshot.comparisonPage;
  const baselineClicks = comparison?.clicks ?? page.clicks;
  const clicksDeltaPct =
    baselineClicks === 0 ? 0 : Math.round(((page.clicks - baselineClicks) / baselineClicks) * 100);
  return {
    page: recommendation.page,
    clicks: page.clicks,
    clicksDeltaPct,
    impressions: page.impressions,
    ctr: formatCtr(page.ctr),
    position: page.position,
    positionBaseline: comparison?.position ?? page.position,
    finding: recommendation.finding,
    recommendedChange: recommendation.recommendedAction,
    why: recommendation.rationale,
    evidence: {
      windowLabel: recommendation.snapshot.meta.period.label,
      rows: recommendation.evidence.rows.map((row) => ({ ...row })),
    },
  };
}
