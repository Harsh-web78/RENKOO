/**
 * RENKO DATA CONTRACT — canonical types.
 *
 * This module is the typed seam between "wherever search data comes from"
 * and "what the product UI renders." Nothing in here knows about React,
 * Next.js, or how data was fetched — it is deliberately plain TypeScript
 * so it can be shared with a future backend or moved into a package.
 *
 * Layering (Prompt 5 section 2):
 *
 *   DATA SOURCE  →  NORMALIZED SEARCH DATA  →  SIGNAL DETECTION
 *                →  RECOMMENDATION  →  PRODUCT UI
 *
 * A real backend integration should be able to implement `SearchDataProvider`
 * (see provider.ts) and return these exact shapes without any change to
 * Home, Fixes, History, or EvidenceDrawer.
 */

/* ------------------------------------------------------------------ */
/* Data source & property                                              */
/* ------------------------------------------------------------------ */

export type SearchDataSourceId = "google-search-console";

export interface SearchDataSource {
  id: SearchDataSourceId;
  label: string;
}

export const googleSearchConsole: SearchDataSource = {
  id: "google-search-console",
  label: "Google Search Console",
};

export type SearchPropertyType = "domain" | "url-prefix";

export interface SearchProperty {
  id: string;
  name: string;
  type: SearchPropertyType;
}

/* ------------------------------------------------------------------ */
/* Period                                                               */
/* ------------------------------------------------------------------ */

/**
 * A single canonical period representation used everywhere a date range
 * needs to be communicated — comparison windows, applied dates, expected
 * measurement dates. See dates.ts for the functions that build/format
 * these; components should not compute date math themselves.
 */
export interface SearchPeriod {
  /** Inclusive ISO start date. */
  start: string;
  /** Inclusive ISO end date. */
  end: string;
  /** Human-readable label, e.g. "Last 28 days vs. prior 28 days". */
  label: string;
}

/* ------------------------------------------------------------------ */
/* Rows — normalized (numeric) vs. evidence (display-ready)            */
/* ------------------------------------------------------------------ */

/**
 * The canonical, numeric row shape a real Search Console integration
 * would return — CTR as a 0–1 ratio, not a pre-formatted string. Signal
 * detection and any future recommendation logic should operate on this
 * shape, not on display strings.
 */
export interface SearchQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchPageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Display-ready row (CTR/position pre-formatted) — what EvidenceDrawer renders. */
export interface EvidenceQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: string;
  position: string;
}

/* ------------------------------------------------------------------ */
/* Freshness & quality — never assume "fresh" or "complete"            */
/* ------------------------------------------------------------------ */

export type SearchDataFreshness = "fresh" | "delayed" | "stale" | "unavailable";

export type SearchDataQuality = "complete" | "partial" | "missing" | "delayed" | "conflicting" | "unavailable";

/**
 * Attached to every snapshot and every piece of evidence. This is what
 * lets the product answer "what data produced this conclusion?" and
 * disclose limitations honestly instead of presenting partial data as if
 * it were complete.
 */
export interface SearchDataMeta {
  source: SearchDataSource;
  property: SearchProperty;
  period: SearchPeriod;
  /** Last date actually covered by the data (Search Console reports with a lag). */
  dataThrough: string;
  /** When this snapshot was retrieved from the source. */
  retrievedAt: string;
  freshness: SearchDataFreshness;
  quality: SearchDataQuality;
  /** Human-readable caveats, e.g. "Only the top 25 queries were returned." */
  limitations: string[];
}

export interface SearchPerformanceSnapshot {
  meta: SearchDataMeta;
  page: SearchPageRow;
  /** Prior-period figures for the same page, when available. */
  comparisonPage?: SearchPageRow;
  queries: SearchQueryRow[];
}

/* ------------------------------------------------------------------ */
/* Signal detection                                                     */
/* ------------------------------------------------------------------ */

export type SearchSignalType = "ctr-below-expected" | "position-decline" | "content-relevance-gap";

export interface SearchSignal {
  type: SearchSignalType;
  page: string;
  snapshot: SearchPerformanceSnapshot;
  detectedAt: string;
}

/* ------------------------------------------------------------------ */
/* Recommendation — fact / interpretation / recommendation, kept apart */
/* ------------------------------------------------------------------ */

export interface RecommendationEvidence {
  rows: EvidenceQueryRow[];
}

export interface Recommendation {
  id: string;
  page: string;
  signal: SearchSignalType;
  /** OBSERVED FACT, in plain language. */
  finding: string;
  /** INTERPRETATION — what the facts may indicate; never proven causation. */
  interpretation: string;
  /** RECOMMENDATION — exactly one concrete action. */
  recommendedAction: string;
  /** Ties the evidence to the recommendation in one sentence. */
  rationale: string;
  /** The normalized snapshot this recommendation was derived from — the single source of provenance (source/property/period/dataThrough/freshness/quality/limitations all live on `snapshot.meta`). */
  snapshot: SearchPerformanceSnapshot;
  evidence: RecommendationEvidence;
  limitations: string[];
}

export type RecommendationResultStatus =
  | "recommendation-available"
  | "no-signal"
  | "insufficient-data"
  | "stale-data"
  | "unavailable";

/**
 * What a provider returns when asked "what should this property work on
 * next?" — a recommendation is only one of five honest outcomes, never
 * fabricated to fill the slot.
 */
export interface RecommendationResult {
  status: RecommendationResultStatus;
  recommendation?: Recommendation;
  /** Present even without a recommendation, so the UI can explain freshness/quality context. */
  meta?: SearchDataMeta;
}
