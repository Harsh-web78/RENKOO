/**
 * Frontend-facing API contracts for auth, onboarding, Search Console, and
 * analysis. These are the shapes the real backend should produce later —
 * every mock service in `lib/mock/` returns exactly these types so no
 * screen needs to change when a real API replaces the mock layer.
 */

import type { RecommendationEvidence, SearchDataMeta } from "../data-contract/types.ts";

export interface User {
  id: string;
  email: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export type GoogleConnectionStatus =
  | "not-connected"
  | "connecting"
  | "redirecting"
  | "returning"
  | "connected"
  | "permission-denied"
  | "permission-insufficient"
  | "account-mismatch"
  | "expired"
  | "network-failure"
  | "server-failure";

export interface GoogleConnection {
  status: GoogleConnectionStatus;
  googleAccountEmail?: string;
}

export type PropertyStatus = "healthy" | "needs-attention" | "stale" | "disconnected";
export type PropertyType = "domain" | "url-prefix";

export interface SearchConsoleProperty {
  id: string;
  name: string;
  type: PropertyType;
  status: PropertyStatus;
  selectable: boolean;
}

export type AnalysisStatus =
  | "queued"
  | "connecting"
  | "loading-data"
  | "analyzing"
  | "ranking"
  | "complete"
  | "insufficient-data"
  | "no-opportunity"
  | "timeout"
  | "failed";

export interface AnalysisJob {
  id: string;
  propertyId: string;
  status: AnalysisStatus;
  startedAt: string;
  referenceId: string;
}

export interface FixEvidenceRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: string;
  position: string;
}

export interface FixEvidence {
  windowLabel: string;
  rows: FixEvidenceRow[];
}

export interface FixRecommendation {
  page: string;
  clicks: number;
  clicksDeltaPct: number;
  impressions: number;
  ctr: string;
  position: number;
  positionBaseline: number;
  finding: string;
  recommendedChange: string;
  why: string;
  evidence: FixEvidence;
}

/**
 * The full mock onboarding/session record. In production this is server
 * state (a session + database rows); here it's the one object the mock
 * layer persists so the frontend can be built against its final shape.
 */
export interface OnboardingState {
  workspaceName: string | null;
  connection: GoogleConnection;
  propertyId: string | null;
  analysisStatus: AnalysisStatus | null;
  fix: FixRecommendation | null;
}

export interface AuthState {
  status: "logged-out" | "authenticated";
  user: User | null;
}

/* ------------------------------------------------------------------ */
/* Core product (Prompt 4): current fix lifecycle, outcomes, history   */
/* ------------------------------------------------------------------ */

export type FixStatus = "available" | "reviewed" | "applied" | "dismissed";

export type DismissReason = "already-fixed" | "not-applicable" | "wrong-recommendation" | "not-a-priority" | "other";

export const dismissReasons: { value: DismissReason; label: string }[] = [
  { value: "already-fixed", label: "Already fixed" },
  { value: "not-applicable", label: "Not applicable" },
  { value: "wrong-recommendation", label: "Wrong recommendation" },
  { value: "not-a-priority", label: "Not a priority" },
  { value: "other", label: "Other" },
];

/** Why there's no active fix to show right now — each maps to a distinct, honest Home state. */
export type NoFixReason = "no-fix" | "insufficient-data" | "stale-data" | "connection-error";

export interface FixBaseline {
  clicks: number;
  ctr: string;
  position: number;
  capturedAt: string;
}

export interface FixOutcomeMetrics {
  clicks: number;
  ctr: string;
  position: number;
}

export type OutcomeStatus =
  | "positive-change"
  | "no-material-change"
  | "negative-change"
  | "insufficient-data"
  | "data-delayed"
  | "conflicting-data"
  | "unavailable";

export interface FixOutcome {
  status: OutcomeStatus;
  before: FixOutcomeMetrics;
  after?: FixOutcomeMetrics;
  measuredAt?: string;
}

/**
 * The product's current recommendation. Populated via
 * `lib/data-contract/adapters.ts` from a canonical `Recommendation` (Prompt
 * 5's data contract) — this is the UI-facing shape; the contract's richer
 * types (SearchDataMeta, SearchPerformanceSnapshot, ...) are what actually
 * carry provenance/freshness/quality before being flattened here.
 */
export interface ProductFix {
  id: string;
  page: string;
  clicks: number;
  clicksDeltaPct: number;
  impressions: number;
  ctr: string;
  position: number;
  positionBaseline: number;
  /** Plain-language OBSERVED condition. */
  finding: string;
  /** INTERPRETATION — what the observed facts suggest, kept separate from proven causation. */
  interpretation: string;
  /** RECOMMENDATION — exactly one concrete action. */
  recommendedChange: string;
  why: string;
  evidence: RecommendationEvidence;
  /** Provenance: source, property, period, data-through date, freshness, quality, limitations. */
  dataMeta: SearchDataMeta;
  status: FixStatus;
  dismissReason?: DismissReason;
  baseline?: FixBaseline;
  appliedAt?: string;
  measurementWindowDays: number;
  expectedMeasurementDate?: string;
  outcome?: FixOutcome;
}

export interface HistoryItem {
  id: string;
  fix: ProductFix;
  page: string;
  recommendedChange: string;
  status: "measured" | "waiting" | "dismissed";
  appliedAt: string | null;
  dismissReason?: DismissReason;
  outcome?: FixOutcome;
}

export interface PropertyProductState {
  currentFix: ProductFix | null;
  history: HistoryItem[];
  /** Only meaningful when currentFix is null — explains why, honestly. */
  noFixReason: NoFixReason;
  lastCheckedAt: string;
  nextCheckAt: string;
  /** Last date data successfully synced — used for stale/connection-error copy. */
  lastSuccessfulDataAt: string;
}

export interface ProductState {
  byProperty: Record<string, PropertyProductState>;
}
