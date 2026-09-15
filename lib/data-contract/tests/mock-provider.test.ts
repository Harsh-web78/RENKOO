import { test } from "node:test";
import assert from "node:assert/strict";
import { MockSearchDataProvider, mockProviderSync, formatCtr, toEvidenceRow } from "../mock-provider.ts";
import { makeTrailingPeriod } from "../dates.ts";

test("getProperties returns the known mock property set", async () => {
  const result = await MockSearchDataProvider.getProperties();
  assert.equal(result.ok, true);
  if (result.ok) {
    const ids = result.data.map((p) => p.id);
    assert.ok(ids.includes("example.com"));
    assert.ok(ids.includes("clientsite.com"));
  }
});

test("COMPLETE data: example.com returns a full, fresh snapshot with a recommendation", async () => {
  const result = await MockSearchDataProvider.getRecommendationResult("example.com");
  assert.equal(result.status, "recommendation-available");
  assert.ok(result.recommendation);
  const { snapshot } = result.recommendation!;
  assert.equal(snapshot.meta.quality, "complete");
  assert.equal(snapshot.meta.freshness, "fresh");
  assert.equal(snapshot.meta.source.id, "google-search-console");
  assert.equal(snapshot.meta.limitations.length, 0);
});

test("PARTIAL/MISSING data: clientsite.com reports missing quality and never fabricates a recommendation", async () => {
  const period = makeTrailingPeriod(28);
  const snapshotResult = await MockSearchDataProvider.getPerformanceSnapshot("clientsite.com", period);
  assert.equal(snapshotResult.ok, true);
  if (snapshotResult.ok) {
    assert.equal(snapshotResult.data.meta.quality, "missing");
    assert.ok(snapshotResult.data.meta.limitations.length > 0, "missing data must disclose why");
  }

  const recResult = await MockSearchDataProvider.getRecommendationResult("clientsite.com");
  assert.equal(recResult.status, "insufficient-data");
  assert.equal(recResult.recommendation, undefined, "insufficient data must never carry a fabricated recommendation");
});

test("STALE data: staleclient.com reports stale freshness with an honest last-good date, no recommendation", async () => {
  const period = makeTrailingPeriod(28);
  const snapshotResult = await MockSearchDataProvider.getPerformanceSnapshot("staleclient.com", period);
  assert.equal(snapshotResult.ok, true);
  if (snapshotResult.ok) {
    assert.equal(snapshotResult.data.meta.freshness, "stale");
    // dataThrough must be in the past relative to the period end (i.e. not silently "fresh").
    assert.ok(new Date(snapshotResult.data.meta.dataThrough).getTime() < new Date(period.end).getTime());
  }

  const recResult = await MockSearchDataProvider.getRecommendationResult("staleclient.com");
  assert.equal(recResult.status, "stale-data");
  assert.equal(recResult.recommendation, undefined);
});

test("UNAVAILABLE data: oldproject.com's snapshot fetch fails with a normalized UPSTREAM_ERROR, never a raw error", async () => {
  const period = makeTrailingPeriod(28);
  const snapshotResult = await MockSearchDataProvider.getPerformanceSnapshot("oldproject.com", period);
  assert.equal(snapshotResult.ok, false);
  if (!snapshotResult.ok) {
    assert.equal(snapshotResult.error.code, "UPSTREAM_ERROR");
  }

  const recResult = await MockSearchDataProvider.getRecommendationResult("oldproject.com");
  assert.equal(recResult.status, "unavailable");
  assert.equal(recResult.recommendation, undefined);
});

test("PROPERTY_NOT_FOUND: an unknown property id is a normalized error, not a crash", async () => {
  const period = makeTrailingPeriod(28);
  const result = await MockSearchDataProvider.getPerformanceSnapshot("not-a-real-property.com", period);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "PROPERTY_NOT_FOUND");
});

test("the synchronous core and the async interface agree on every property (no drift between the two seams)", async () => {
  const period = makeTrailingPeriod(28);
  for (const id of ["example.com", "www.example.com", "clientsite.com", "staleclient.com"]) {
    const asyncResult = await MockSearchDataProvider.getRecommendationResult(id);
    const syncResult = mockProviderSync.getRecommendationResult(id, period);
    assert.equal(asyncResult.status, syncResult.status, `status should match for ${id}`);
  }
});

test("formatCtr renders a numeric ratio as a display percentage", () => {
  assert.equal(formatCtr(0.026), "2.6%");
  assert.equal(formatCtr(0), "0.0%");
  assert.equal(formatCtr(1), "100.0%");
});

test("toEvidenceRow converts a canonical numeric row into a display-ready row without altering the underlying values", () => {
  const row = toEvidenceRow({ query: "pricing plans", clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 });
  assert.equal(row.query, "pricing plans");
  assert.equal(row.clicks, 31);
  assert.equal(row.impressions, 1180);
  assert.equal(row.ctr, "2.6%");
  assert.equal(row.position, "4.1");
});
