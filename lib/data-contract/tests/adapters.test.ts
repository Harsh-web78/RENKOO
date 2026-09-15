import { test } from "node:test";
import assert from "node:assert/strict";
import { MockSearchDataProvider } from "../mock-provider.ts";
import {
  recommendationFromOnboardingFix,
  recommendationResultStatusToNoFixReason,
  recommendationToProductFix,
} from "../adapters.ts";
import type { FixRecommendation } from "../../mock/types.ts";

test("recommendationToProductFix carries the exact metrics from the snapshot, not recomputed guesses", async () => {
  const result = await MockSearchDataProvider.getRecommendationResult("example.com");
  const fix = recommendationToProductFix(result.recommendation!, 14);

  assert.equal(fix.page, "/pricing");
  assert.equal(fix.clicks, result.recommendation!.snapshot.page.clicks);
  assert.equal(fix.impressions, result.recommendation!.snapshot.page.impressions);
  assert.equal(fix.position, result.recommendation!.snapshot.page.position);
  assert.equal(fix.measurementWindowDays, 14);
  assert.equal(fix.status, "available");
});

test("recommendationToProductFix computes clicksDeltaPct from current vs. comparison clicks, matching the observable numbers", async () => {
  const result = await MockSearchDataProvider.getRecommendationResult("example.com");
  const fix = recommendationToProductFix(result.recommendation!, 14);
  const { page, comparisonPage } = result.recommendation!.snapshot;
  const expectedDelta = Math.round(((page.clicks - comparisonPage!.clicks) / comparisonPage!.clicks) * 100);
  assert.equal(fix.clicksDeltaPct, expectedDelta);
});

test("recommendationToProductFix carries full provenance (dataMeta) through to the UI-facing fix", async () => {
  const result = await MockSearchDataProvider.getRecommendationResult("example.com");
  const fix = recommendationToProductFix(result.recommendation!, 14);
  assert.equal(fix.dataMeta.source.label, "Google Search Console");
  assert.equal(fix.dataMeta.quality, "complete");
  assert.equal(fix.dataMeta.freshness, "fresh");
});

test("recommendationFromOnboardingFix preserves every observable number from the onboarding fix with no data loss", () => {
  const onboardingFix: FixRecommendation = {
    page: "/pricing",
    clicks: 74,
    clicksDeltaPct: -34,
    impressions: 2840,
    ctr: "2.6%",
    position: 4.2,
    positionBaseline: 1.8,
    finding: "test finding",
    recommendedChange: "test recommendation",
    why: "test rationale",
    evidence: {
      windowLabel: "Last 28 days vs. prior 28 days",
      rows: [{ query: "test query", clicks: 10, impressions: 100, ctr: "10.0%", position: "2.0" }],
    },
  };

  const recommendation = recommendationFromOnboardingFix(onboardingFix, "example.com::fix-live");
  const fix = recommendationToProductFix(recommendation, 14);

  assert.equal(fix.page, onboardingFix.page);
  assert.equal(fix.clicks, onboardingFix.clicks);
  assert.equal(fix.impressions, onboardingFix.impressions);
  assert.equal(fix.finding, onboardingFix.finding);
  assert.equal(fix.recommendedChange, onboardingFix.recommendedChange);
  assert.equal(fix.why, onboardingFix.why);
  assert.equal(fix.evidence.rows.length, 1);
  assert.equal(fix.evidence.rows[0]!.query, "test query");
});

test("recommendationResultStatusToNoFixReason maps every honest non-recommendation status to the correct UI reason", () => {
  assert.equal(recommendationResultStatusToNoFixReason("insufficient-data"), "insufficient-data");
  assert.equal(recommendationResultStatusToNoFixReason("stale-data"), "stale-data");
  assert.equal(recommendationResultStatusToNoFixReason("unavailable"), "connection-error");
  assert.equal(recommendationResultStatusToNoFixReason("no-signal"), "no-fix");
});
