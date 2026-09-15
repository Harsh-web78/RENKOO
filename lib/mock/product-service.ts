import type { FixOutcome, FixRecommendation, HistoryItem, OutcomeStatus, ProductFix, PropertyProductState } from "./types.ts";
import { addDays, daysAgoIso, formatDate, makeTrailingPeriod, nowIso } from "../data-contract/dates.ts";
import { mockProviderSync } from "../data-contract/mock-provider.ts";
import {
  recommendationFromOnboardingFix,
  recommendationResultStatusToNoFixReason,
  recommendationToProductFix,
} from "../data-contract/adapters.ts";
import { googleSearchConsole, type SearchDataMeta } from "../data-contract/types.ts";

/**
 * MOCK PRODUCT SERVICE — development only.
 *
 * As of Prompt 5, this file is a thin orchestration layer: the actual
 * deterministic data lives behind `lib/data-contract/mock-provider.ts`
 * (implementing the `SearchDataProvider` seam), and the conversion to the
 * UI-facing `ProductFix`/`PropertyProductState` shapes happens in
 * `lib/data-contract/adapters.ts`. This file's exported function names and
 * signatures are unchanged from Prompt 4 on purpose — `session-context.tsx`
 * and every component that calls them did not need to change.
 */

export const MEASUREMENT_WINDOW_DAYS = 14;

export { addDays, formatDate };

/** Simple deterministic hash so the same fix id always produces the same mock outcome. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 1000;
  }
  return hash;
}

export function simulateOutcome(fix: ProductFix, measuredAt: string): FixOutcome {
  const bucket = hashString(fix.id) % 3;
  const statuses: OutcomeStatus[] = ["positive-change", "no-material-change", "negative-change"];
  const status = statuses[bucket];

  const before = {
    clicks: fix.baseline?.clicks ?? fix.clicks,
    ctr: fix.baseline?.ctr ?? fix.ctr,
    position: fix.baseline?.position ?? fix.position,
  };

  if (status === "positive-change") {
    return {
      status,
      before,
      after: { clicks: before.clicks + 22, ctr: "3.4%", position: Math.max(1, before.position - 1.1) },
      measuredAt,
    };
  }
  if (status === "negative-change") {
    return {
      status,
      before,
      after: { clicks: Math.max(0, before.clicks - 9), ctr: "2.2%", position: before.position + 0.4 },
      measuredAt,
    };
  }
  return {
    status: "no-material-change",
    before,
    after: { clicks: before.clicks + 2, ctr: before.ctr, position: before.position - 0.1 },
    measuredAt,
  };
}

/** Converts the onboarding First Fix Reveal's recommendation into a full ProductFix, with no data loss. */
export function fromOnboardingFix(fix: FixRecommendation, id: string): ProductFix {
  const recommendation = recommendationFromOnboardingFix(fix, id);
  return recommendationToProductFix(recommendation, MEASUREMENT_WINDOW_DAYS);
}

/** Deterministic seed fix for a second demo property, so switching properties visibly shows different data. */
export function seedSecondaryFix(id: string): ProductFix {
  const period = makeTrailingPeriod(28);
  const result = mockProviderSync.getRecommendationResult("www.example.com", period);
  if (result.status !== "recommendation-available" || !result.recommendation) {
    throw new Error("seedSecondaryFix: mock provider did not return a recommendation for www.example.com");
  }
  return recommendationToProductFix({ ...result.recommendation, id }, MEASUREMENT_WINDOW_DAYS);
}

function historyMeta(page: string, dataThrough: string): SearchDataMeta {
  return {
    source: googleSearchConsole,
    property: { id: "example.com", name: "example.com", type: "domain" },
    period: makeTrailingPeriod(28, dataThrough),
    dataThrough,
    retrievedAt: dataThrough,
    freshness: "fresh",
    quality: "complete",
    limitations: [],
  };
}

/** Two static past fixes, so a workspace with real history isn't a hypothetical — used for the "example.com" demo property only. */
export function seedHistory(propertyId: string): HistoryItem[] {
  const appliedAt1 = daysAgoIso(52);
  const measuredAt1 = daysAgoIso(38);
  const fix1: ProductFix = {
    id: `${propertyId}::fix-hist-1`,
    page: "/features",
    clicks: 58,
    clicksDeltaPct: -21,
    impressions: 1900,
    ctr: "3.1%",
    position: 3.4,
    positionBaseline: 2.6,
    finding: "This page's click-through rate had fallen below comparable pages at the same position.",
    interpretation: "The page kept its ranking but its title no longer stood out in search results.",
    recommendedChange: "Rewrite the meta description to lead with the specific benefit users search for.",
    why: "CTR was 3.1% against a typical 4.2% for pages at position 3.4 for similar queries.",
    evidence: { rows: [{ query: "renko features", clicks: 34, impressions: 980, ctr: "3.5%", position: "3.2" }] },
    dataMeta: historyMeta("/features", appliedAt1),
    status: "applied",
    baseline: { clicks: 58, ctr: "3.1%", position: 3.4, capturedAt: appliedAt1 },
    appliedAt: appliedAt1,
    measurementWindowDays: MEASUREMENT_WINDOW_DAYS,
    expectedMeasurementDate: addDays(appliedAt1, MEASUREMENT_WINDOW_DAYS),
  };
  fix1.outcome = {
    status: "positive-change",
    before: { clicks: 58, ctr: "3.1%", position: 3.4 },
    after: { clicks: 79, ctr: "4.0%", position: 2.9 },
    measuredAt: measuredAt1,
  };

  const appliedAt2 = daysAgoIso(29);
  const measuredAt2 = daysAgoIso(15);
  const fix2: ProductFix = {
    id: `${propertyId}::fix-hist-2`,
    page: "/integrations",
    clicks: 40,
    clicksDeltaPct: -12,
    impressions: 1500,
    ctr: "2.7%",
    position: 4.8,
    positionBaseline: 4.1,
    finding: "Impressions were steady but clicks softened slightly over the comparison window.",
    interpretation: "The drop was modest enough that it may reflect normal variation rather than a real regression.",
    recommendedChange: "Tighten the H1 to match the exact phrase used in the top query for this page.",
    why: "Clicks declined 12% while impressions held within 3% of the prior period.",
    evidence: { rows: [{ query: "renko integrations", clicks: 22, impressions: 760, ctr: "2.9%", position: "4.6" }] },
    dataMeta: historyMeta("/integrations", appliedAt2),
    status: "applied",
    baseline: { clicks: 40, ctr: "2.7%", position: 4.8, capturedAt: appliedAt2 },
    appliedAt: appliedAt2,
    measurementWindowDays: MEASUREMENT_WINDOW_DAYS,
    expectedMeasurementDate: addDays(appliedAt2, MEASUREMENT_WINDOW_DAYS),
  };
  fix2.outcome = {
    status: "no-material-change",
    before: { clicks: 40, ctr: "2.7%", position: 4.8 },
    after: { clicks: 42, ctr: "2.7%", position: 4.7 },
    measuredAt: measuredAt2,
  };

  return [
    { id: fix1.id, fix: fix1, page: fix1.page, recommendedChange: fix1.recommendedChange, status: "measured", appliedAt: fix1.appliedAt!, outcome: fix1.outcome },
    { id: fix2.id, fix: fix2, page: fix2.page, recommendedChange: fix2.recommendedChange, status: "measured", appliedAt: fix2.appliedAt!, outcome: fix2.outcome },
  ];
}

/**
 * Seeds the initial per-property product state the first time a property
 * is visited in the product. `onboardingFix` lets the property the user
 * completed onboarding with continue seamlessly from the fix they already
 * saw in the First Fix Reveal, instead of silently swapping to different
 * demo data.
 *
 * Internally this now goes through `mockProviderSync` (the same
 * deterministic logic the async `SearchDataProvider` interface exposes)
 * and `recommendationResultStatusToNoFixReason` for the honest-empty
 * cases, rather than hardcoding property-id branches directly here.
 */
export function seedPropertyState(propertyId: string, onboardingFix: FixRecommendation | null): PropertyProductState {
  const now = nowIso();
  const base: Omit<PropertyProductState, "currentFix" | "history"> = {
    noFixReason: "no-fix",
    lastCheckedAt: now,
    nextCheckAt: addDays(now, 7),
    lastSuccessfulDataAt: now,
  };

  const period = makeTrailingPeriod(28, now);

  if (propertyId === "example.com") {
    if (onboardingFix) {
      const fix = fromOnboardingFix(onboardingFix, `${propertyId}::fix-live`);
      return { ...base, currentFix: fix, history: seedHistory(propertyId) };
    }
    // No onboarding override — fall through to example.com's own default
    // recommendation from the provider (never another property's content).
    const result = mockProviderSync.getRecommendationResult(propertyId, period);
    if (result.status === "recommendation-available" && result.recommendation) {
      const fix = recommendationToProductFix({ ...result.recommendation, id: `${propertyId}::fix-live` }, MEASUREMENT_WINDOW_DAYS);
      return { ...base, currentFix: fix, history: seedHistory(propertyId) };
    }
  }

  const result = mockProviderSync.getRecommendationResult(propertyId, period);

  if (result.status === "recommendation-available" && result.recommendation) {
    const fix = recommendationToProductFix({ ...result.recommendation, id: `${propertyId}::fix-live` }, MEASUREMENT_WINDOW_DAYS);
    return { ...base, currentFix: fix, history: [] };
  }

  const noFixReason = recommendationResultStatusToNoFixReason(result.status);
  const lastSuccessfulDataAt = result.meta?.dataThrough ?? now;
  return { ...base, currentFix: null, noFixReason, lastSuccessfulDataAt, history: [] };
}
