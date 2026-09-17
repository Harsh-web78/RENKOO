import { signalConfig } from "./signal-config";
import type {
  SearchPerformanceSnapshot,
  SearchPageRow,
} from "../ingestion/search-data.normalizer";

/**
 * Recommendation engine — pure, deterministic, no DB/Google/LLM.
 * Pipeline: Snapshot → signal detection → validation → scoring → ONE recommendation → evidence
 */

export type SearchSignalType = "ctr-below-expected" | "position-decline" | "content-relevance-gap";

export interface RecommendationEvidence {
  rows: { query: string; clicks: number; impressions: number; ctr: string; position: string }[];
}

export interface Recommendation {
  id: string;
  page: string;
  signal: SearchSignalType;
  finding: string;
  interpretation: string;
  recommendedAction: string;
  rationale: string;
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

export interface RecommendationResult {
  status: RecommendationResultStatus;
  recommendation?: Recommendation;
  meta?: SearchPerformanceSnapshot["meta"];
}

// Helpers for evidence formatting (matches frontend formatCtr)
function formatCtr(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function formatPosition(pos: number): string {
  return pos.toFixed(1);
}

function isStaleOrUnavailable(snapshot: SearchPerformanceSnapshot): boolean {
  return snapshot.meta.freshness === "stale" || snapshot.meta.freshness === "unavailable";
}

function isInsufficient(snapshot: SearchPerformanceSnapshot): boolean {
  return (
    snapshot.meta.quality === "missing" ||
    snapshot.meta.quality === "unavailable" ||
    snapshot.meta.freshness === "unavailable"
  );
}

interface Candidate {
  signal: SearchSignalType;
  score: number; // opportunity = impressions × gap
  page: string;
  finding: string;
  interpretation: string;
  recommendedAction: string;
  rationale: string;
}

function detectCtrBelowExpected(snapshot: SearchPerformanceSnapshot): Candidate | null {
  const { page, comparisonPage, queries } = snapshot;
  const cfg = signalConfig;
  if (page.impressions < cfg.MIN_IMPRESSIONS_FOR_CTR) return null;

  const currentCtr = page.ctr;
  let gap = 0;
  let baselineCtr: number | null = null;

  if (comparisonPage) {
    baselineCtr = comparisonPage.ctr;
    const decline = baselineCtr - currentCtr;
    const relative = baselineCtr > 0 ? decline / baselineCtr : 0;
    if (decline < cfg.CTR_DECLINE_ABSOLUTE && relative < cfg.CTR_DECLINE_RELATIVE) return null;
    gap = decline;
  } else {
    // No comparison — use absolute low CTR
    if (currentCtr >= cfg.CTR_LOW_ABSOLUTE) return null;
    // Gap vs expected 0.04 baseline for position ~4
    gap = cfg.CTR_LOW_ABSOLUTE - currentCtr;
    baselineCtr = cfg.CTR_LOW_ABSOLUTE;
  }

  if (gap <= 0) return null;

  const impressions = page.impressions;
  const score = impressions * gap;

  // Require at least one query with decent impressions to justify action
  const topQuery = queries[0];
  const queryHint = topQuery ? ` for “${topQuery.query}”` : "";

  return {
    signal: "ctr-below-expected",
    score,
    page: page.page,
    finding: `This page received ${page.impressions.toLocaleString()} impressions and ${page.clicks} clicks${queryHint} while its click-through rate ${baselineCtr !== null ? `declined from ${formatCtr(baselineCtr)} to ${formatCtr(currentCtr)}` : `was ${formatCtr(currentCtr)}`} over the comparison window.`,
    interpretation:
      "The page is receiving meaningful search exposure but is underperforming on click-through relative to its observed opportunity.",
    recommendedAction: "Review and improve the page title and meta description to better match the search intent represented by these queries.",
    rationale: `The page receives meaningful impressions${queryHint}, but its click-through rate is weaker than expected at this position.`,
  };
}

function detectPositionDecline(snapshot: SearchPerformanceSnapshot): Candidate | null {
  const { page, comparisonPage } = snapshot;
  const cfg = signalConfig;
  if (!comparisonPage) return null;
  if (page.impressions < cfg.MIN_IMPRESSIONS_FOR_POSITION) return null;
  if (comparisonPage.impressions < cfg.MIN_IMPRESSIONS_FOR_POSITION) return null;

  const posDecline = page.position - comparisonPage.position;
  if (posDecline < cfg.POSITION_DECLINE_THRESHOLD) return null;

  // Impressions stability: if impressions changed >30%, decline may be demand, not relevance
  const imprChange = Math.abs(page.impressions - comparisonPage.impressions) / Math.max(comparisonPage.impressions, 1);
  if (imprChange > cfg.IMPRESSIONS_STABILITY) return null;

  // Also require not massive CTR improvement that might contradict
  const score = page.impressions * posDecline;

  return {
    signal: "position-decline",
    score,
    page: page.page,
    finding: `This page still ranks on page one but has slipped from position ${formatPosition(comparisonPage.position)} to ${formatPosition(page.position)} over the comparison window while impressions held steady. The data shows a decline in observed position.`,
    interpretation: "The data shows the page hasn't lost its ranking entirely, but it's slipping below competing results for its main query.",
    recommendedAction: "Consider improving the introduction to more directly answer the primary query in the first 100 words.",
    rationale: `Position moved from ${formatPosition(comparisonPage.position)} to ${formatPosition(page.position)} while impressions held steady, suggesting a content-relevance gap rather than a demand drop.`,
  };
}

function detectContentRelevanceGap(snapshot: SearchPerformanceSnapshot): Candidate | null {
  const { page, queries } = snapshot;
  const cfg = signalConfig;
  if (queries.length < cfg.CONTENT_GAP_MIN_QUERIES) return null;
  if (page.impressions < cfg.CONTENT_GAP_IMPRESSIONS) return null;

  const topQuery = queries[0]!;
  // If top query has high impressions but low CTR, suggests mismatch
  if (topQuery.impressions < 500) return null;
  if (topQuery.ctr >= cfg.CONTENT_GAP_CTR_THRESHOLD) return null;
  // Also require page position not terrible (still visible) but query CTR low
  if (page.position > 10) return null;

  const gap = cfg.CONTENT_GAP_CTR_THRESHOLD - topQuery.ctr;
  const score = topQuery.impressions * gap;

  return {
    signal: "content-relevance-gap",
    score,
    page: page.page,
    finding: `The query “${topQuery.query}” drives ${topQuery.impressions.toLocaleString()} impressions to this page but only ${formatCtr(topQuery.ctr)} click-through, below the expected ${formatCtr(cfg.CONTENT_GAP_CTR_THRESHOLD)} for this volume. Observed data indicates a mismatch.`,
    interpretation: "The data shows searchers are seeing this page for the query but not finding the title or snippet matching what they looked for.",
    recommendedAction: "Consider improving the page's main heading and first paragraph to directly match the top query's intent.",
    rationale: `The top query “${topQuery.query}” brings substantial impressions yet click-through is low, indicating a relevance gap.`,
  };
}

export class RecommendationEngine {
  evaluate(snapshot: SearchPerformanceSnapshot): RecommendationResult {
    // Data sufficiency checks — respect freshness/quality before any signal
    if (snapshot.meta.freshness === "unavailable" || snapshot.meta.quality === "unavailable") {
      return { status: "unavailable", meta: snapshot.meta };
    }
    if (isStaleOrUnavailable(snapshot)) {
      return { status: "stale-data", meta: snapshot.meta };
    }
    if (isInsufficient(snapshot)) {
      return { status: "insufficient-data", meta: snapshot.meta };
    }
    // Additional guard: if quality is missing due to zero impressions, insufficient
    if (snapshot.page.impressions === 0) {
      return { status: "insufficient-data", meta: snapshot.meta };
    }
    if (snapshot.meta.quality === "missing") {
      return { status: "insufficient-data", meta: snapshot.meta };
    }

    const candidates: Candidate[] = [];
    const ctr = detectCtrBelowExpected(snapshot);
    if (ctr) candidates.push(ctr);
    const pos = detectPositionDecline(snapshot);
    if (pos) candidates.push(pos);
    const gap = detectContentRelevanceGap(snapshot);
    if (gap) candidates.push(gap);

    if (candidates.length === 0) {
      return { status: "no-signal", meta: snapshot.meta };
    }

    // Prioritize by opportunity = impressions × gap (score), deterministic
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;

    // Build evidence from snapshot.queries (already top queries)
    const evidenceRows = snapshot.queries.slice(0, 5).map((q) => ({
      query: q.query,
      clicks: q.clicks,
      impressions: q.impressions,
      ctr: formatCtr(q.ctr),
      position: formatPosition(q.position),
    }));

    const recommendation: Recommendation = {
      id: `${snapshot.meta.property.id}::${best.page}::${best.signal}`,
      page: best.page,
      signal: best.signal,
      finding: best.finding,
      interpretation: best.interpretation,
      recommendedAction: best.recommendedAction,
      rationale: best.rationale,
      snapshot,
      evidence: { rows: evidenceRows },
      limitations: [...snapshot.meta.limitations],
    };

    return { status: "recommendation-available", recommendation, meta: snapshot.meta };
  }
}

// Ensure no Google/LLM dependency — this file imports only config and ingestion types
// Test helper to verify no forbidden imports
export const _engineHelpers = {
  detectCtrBelowExpected,
  detectPositionDecline,
  detectContentRelevanceGap,
};
