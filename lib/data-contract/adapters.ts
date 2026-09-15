import type { FixRecommendation, NoFixReason, ProductFix } from "../mock/types.ts";
import { formatCtr, toEvidenceRow } from "./mock-provider.ts";
import { googleSearchConsole } from "./types.ts";
import type { Recommendation, RecommendationResultStatus, SearchDataMeta } from "./types.ts";
import { makeTrailingPeriod, nowIso } from "./dates.ts";

/**
 * ADAPTERS — the only place the canonical data-contract types (Recommendation,
 * SearchDataMeta, ...) convert to/from the UI-facing types introduced in
 * Prompt 4 (ProductFix) and Prompt 3 (FixRecommendation). Keeping the
 * conversion in one place means the rest of the product never has to
 * choose which shape to use — Home/Fixes/History/EvidenceDrawer only ever
 * see ProductFix.
 */

export function recommendationToProductFix(
  recommendation: Recommendation,
  measurementWindowDays: number
): ProductFix {
  const { page: pageMetrics, comparisonPage } = recommendation.snapshot;
  const baselineClicks = comparisonPage?.clicks ?? pageMetrics.clicks;
  const clicksDeltaPct = baselineClicks === 0 ? 0 : Math.round(((pageMetrics.clicks - baselineClicks) / baselineClicks) * 100);

  return {
    id: recommendation.id,
    page: recommendation.page,
    clicks: pageMetrics.clicks,
    clicksDeltaPct,
    impressions: pageMetrics.impressions,
    ctr: formatCtr(pageMetrics.ctr),
    position: pageMetrics.position,
    positionBaseline: comparisonPage?.position ?? pageMetrics.position,
    finding: recommendation.finding,
    interpretation: recommendation.interpretation,
    recommendedChange: recommendation.recommendedAction,
    why: recommendation.rationale,
    evidence: recommendation.evidence,
    dataMeta: recommendation.snapshot.meta,
    status: "available",
    measurementWindowDays,
  };
}

/**
 * Converts the onboarding First Fix Reveal's simpler recommendation shape
 * into the full canonical `Recommendation`, synthesizing the provenance
 * metadata onboarding never needed to track. This is the one bridge
 * between Prompt 3's onboarding output and Prompt 5's data contract.
 */
export function recommendationFromOnboardingFix(fix: FixRecommendation, id: string): Recommendation {
  const period = makeTrailingPeriod(28, nowIso(), fix.evidence.windowLabel);
  const meta: SearchDataMeta = {
    source: googleSearchConsole,
    property: { id: "example.com", name: "example.com", type: "domain" },
    period,
    dataThrough: period.end,
    retrievedAt: nowIso(),
    freshness: "fresh",
    quality: "complete",
    limitations: [],
  };

  return {
    id,
    page: fix.page,
    signal: "ctr-below-expected",
    finding: fix.finding,
    interpretation:
      "The page is still earning meaningful visibility, but it's converting less of that visibility into clicks than it used to.",
    recommendedAction: fix.recommendedChange,
    rationale: fix.why,
    snapshot: {
      meta,
      page: { page: fix.page, clicks: fix.clicks, impressions: fix.impressions, ctr: 0, position: fix.position },
      comparisonPage: { page: fix.page, clicks: 0, impressions: 0, ctr: 0, position: fix.positionBaseline },
      queries: fix.evidence.rows.map((row) => ({
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Number.parseFloat(row.ctr) / 100 || 0,
        position: Number.parseFloat(row.position) || 0,
      })),
    },
    evidence: { rows: fix.evidence.rows.map((row) => ({ ...row })) },
    limitations: [],
  };
}

export function recommendationResultStatusToNoFixReason(status: RecommendationResultStatus): NoFixReason {
  switch (status) {
    case "insufficient-data":
      return "insufficient-data";
    case "stale-data":
      return "stale-data";
    case "unavailable":
      return "connection-error";
    case "no-signal":
    case "recommendation-available":
    default:
      return "no-fix";
  }
}

export { toEvidenceRow };
