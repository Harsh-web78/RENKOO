/**
 * REAL-STATE TESTS — Prompt 13 §14 (pure helpers; mocked data, no backend).
 *
 * Covers: Home view-model with a real recommendation, honest
 * no-recommendation states, property-switch isolation, error→reason
 * mapping distinctions, measurement_pending copy, outcome/property
 * mapping hygiene, and the property-pointer storage contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRecommendationAndFix,
  dataErrorToNoFixReason,
  discardStateForPropertySwitch,
  initialRealPropertyState,
  isMeasurementPending,
  MEASUREMENT_PENDING_COPY,
  pendingNoticeFor,
  readRealPropertyPointer,
  REAL_PROPERTY_POINTER_KEY,
  resolveHomeView,
  writeRealPropertyPointer,
  type StorageLike,
} from "../real-state.ts";
import { mapBackendOutcome, mapBackendProperties } from "../api-provider.ts";
import { dataError } from "../errors.ts";
import type { RecommendationResult } from "../types.ts";
import type { ProductFix } from "../../mock/types.ts";

function sampleFix(overrides: Partial<ProductFix> = {}): ProductFix {
  return {
    id: "fix_1",
    page: "/pricing",
    clicks: 74,
    clicksDeltaPct: -34,
    impressions: 2840,
    ctr: "2.6%",
    position: 4.2,
    positionBaseline: 1.8,
    finding: "Impressions strong, clicks weak.",
    interpretation: "May indicate a title mismatch.",
    recommendedChange: "Rewrite the page title.",
    why: "CTR trails the baseline.",
    evidence: { rows: [{ query: "pricing plans", clicks: 31, impressions: 1180, ctr: "2.6%", position: "4.1" }] },
    dataMeta: {
      source: { id: "google-search-console", label: "Google Search Console" },
      property: { id: "prop_1", name: "example.com", type: "domain" },
      period: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-29T00:00:00.000Z", label: "Last 28 days" },
      dataThrough: "2026-08-29T00:00:00.000Z",
      retrievedAt: "2026-08-30T00:00:00.000Z",
      freshness: "fresh",
      quality: "complete",
      limitations: [],
    },
    status: "available",
    measurementWindowDays: 14,
    ...overrides,
  };
}

function memoryStorage(): StorageLike & { keys(): string[] } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    keys: () => [...store.keys()],
  };
}

test("18. Home renders the real recommendation (view-model resolves to the fix)", () => {
  const fix = sampleFix();
  const state = applyRecommendationAndFix({
    recommendationResult: { status: "recommendation-available" },
    fix,
    recommendation: null,
    localHistory: [],
    now: "2026-08-30T00:00:00.000Z",
  });
  assert.ok(state.currentFix, "backend fix must become the current fix");
  assert.equal(state.currentFix.page, "/pricing");
  assert.equal(state.noFixReason, "no-fix");

  const view = resolveHomeView({
    sessionLoaded: true,
    sessionError: null,
    propertyId: "prop_1",
    propertyStatus: "ready",
    propertyError: null,
    state,
  });
  assert.equal(view.kind, "fix");
  assert.equal(view.state?.currentFix?.recommendedChange, "Rewrite the page title.");
});

test("19. Home renders no-recommendation honestly (insufficient/stale/unavailable stay distinct)", () => {
  const insufficient: RecommendationResult = {
    status: "insufficient-data",
    meta: sampleFix().dataMeta,
  };
  const state = applyRecommendationAndFix({
    recommendationResult: insufficient,
    fix: null,
    recommendation: null,
    localHistory: [],
    now: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(state.currentFix, null);
  assert.equal(state.noFixReason, "insufficient-data");

  const view = resolveHomeView({
    sessionLoaded: true,
    sessionError: null,
    propertyId: "prop_1",
    propertyStatus: "ready",
    propertyError: null,
    state,
  });
  assert.equal(view.kind, "empty");
  assert.equal(view.state?.noFixReason, "insufficient-data");

  const stale = applyRecommendationAndFix({
    recommendationResult: { status: "stale-data" },
    fix: null,
    recommendation: null,
    localHistory: [],
  });
  assert.equal(stale.noFixReason, "stale-data");
  const unavailable = applyRecommendationAndFix({
    recommendationResult: { status: "unavailable" },
    fix: null,
    recommendation: null,
    localHistory: [],
  });
  assert.equal(unavailable.noFixReason, "connection-error");
  assert.notEqual(stale.noFixReason, unavailable.noFixReason, "stale vs unavailable must stay distinct");
});

test("20. property switch discards the previous property's recommendation/fix state", () => {
  const before = {
    states: { prop_old: { ...initialRealPropertyState(), currentFix: sampleFix() } },
    statuses: { prop_old: "ready" as const },
    errors: { prop_old: null },
    notices: { prop_old: "Check back after 14-day window." },
  };
  const after = discardStateForPropertySwitch(before);
  assert.deepEqual(after.states, {});
  assert.deepEqual(after.statuses, {});
  assert.deepEqual(after.errors, {});
  assert.deepEqual(after.notices, {});
  assert.ok(!("prop_old" in after.states), "previous property state must not survive the switch");
});

test("error mapping preserves the honest distinctions (no silent collapse into No Fix)", () => {
  assert.equal(dataErrorToNoFixReason(dataError("INSUFFICIENT_DATA", "x")), "insufficient-data");
  assert.equal(dataErrorToNoFixReason(dataError("STALE_DATA", "x")), "stale-data");
  assert.equal(dataErrorToNoFixReason(dataError("UPSTREAM_ERROR", "x")), "connection-error");
  assert.equal(dataErrorToNoFixReason(dataError("UNKNOWN_ERROR", "x")), "connection-error");
  // Auth/permission/rate-limit/not-found need dedicated UX — never EmptyFixState.
  assert.equal(dataErrorToNoFixReason(dataError("AUTH_REQUIRED", "x")), null);
  assert.equal(dataErrorToNoFixReason(dataError("PERMISSION_DENIED", "x")), null);
  assert.equal(dataErrorToNoFixReason(dataError("RATE_LIMITED", "x")), null);
  assert.equal(dataErrorToNoFixReason(dataError("PROPERTY_NOT_FOUND", "x")), null);
});

test("resolveHomeView covers loading and error states (never a blank screen, never mock data)", () => {
  const loading = resolveHomeView({
    sessionLoaded: false,
    sessionError: null,
    propertyId: null,
    propertyStatus: null,
    propertyError: null,
    state: null,
  });
  assert.equal(loading.kind, "session-loading");

  const sessionError = resolveHomeView({
    sessionLoaded: true,
    sessionError: dataError("AUTH_REQUIRED", "Sign in again."),
    propertyId: null,
    propertyStatus: null,
    propertyError: null,
    state: null,
  });
  assert.equal(sessionError.kind, "session-error");

  const noProperty = resolveHomeView({
    sessionLoaded: true,
    sessionError: null,
    propertyId: null,
    propertyStatus: null,
    propertyError: null,
    state: null,
  });
  assert.equal(noProperty.kind, "no-property");

  const propertyLoading = resolveHomeView({
    sessionLoaded: true,
    sessionError: null,
    propertyId: "prop_1",
    propertyStatus: "loading",
    propertyError: null,
    state: null,
  });
  assert.equal(propertyLoading.kind, "property-loading");
  assert.equal(propertyLoading.state, null, "loading must not expose stale content");

  const propertyError = resolveHomeView({
    sessionLoaded: true,
    sessionError: null,
    propertyId: "prop_1",
    propertyStatus: "error",
    propertyError: dataError("RATE_LIMITED", "slow down"),
    state: null,
  });
  assert.equal(propertyError.kind, "property-error");
});

test("measurement_pending yields the honest pending copy (and detection is exact)", () => {
  assert.ok(isMeasurementPending({ status: "measurement_pending" }));
  assert.ok(!isMeasurementPending({ status: "positive-change" }));
  assert.ok(pendingNoticeFor({ status: "measurement_pending" }).includes(MEASUREMENT_PENDING_COPY));
  assert.ok(
    pendingNoticeFor({
      status: "measurement_pending",
      message: "Measurement window not yet reached — check back after the 14-day window.",
    }).includes(MEASUREMENT_PENDING_COPY),
    "the real backend message must normalize to the exact required copy",
  );
});

test("backend outcome statuses (underscore wire format) map to frontend dashes", () => {
  const outcome = mapBackendOutcome({
    status: "positive_change",
    before: { clicks: 10, ctr: "2.0%", position: 4 },
    after: { clicks: 20, ctr: "3.0%", position: 3 },
    measuredAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(outcome.status, "positive-change");
  assert.equal(outcome.after?.clicks, 20);
  const delayed = mapBackendOutcome({
    status: "data_delayed",
    beforeJson: { clicks: 1, ctr: "1.0%", position: 5 },
    afterJson: null,
  });
  assert.equal(delayed.status, "data-delayed");
  assert.equal(delayed.after, undefined);
});

test("backend property rows map to frontend shape and drop internal siteUrl", () => {
  const rows = mapBackendProperties([
    { id: "p1", displayName: "example.com", type: "domain", status: "healthy", isSelectable: true, siteUrl: "sc-domain:example.com" } as never,
    { id: "p2", name: "https://www.example.com/", type: "url_prefix", status: "needs_attention", isSelectable: false } as never,
  ]);
  assert.equal(rows[0]!.type, "domain");
  assert.equal(rows[0]!.status, "healthy");
  assert.equal(rows[1]!.type, "url-prefix");
  assert.equal(rows[1]!.status, "needs-attention");
  assert.equal(rows[1]!.selectable, false);
  for (const row of rows) {
    assert.ok(!("siteUrl" in row), "internal siteUrl must not cross the mapping boundary");
  }
});

test("client storage holds only the property pointer — never workspace/auth data", () => {
  const storage = memoryStorage();
  writeRealPropertyPointer("prop_1", storage);
  assert.equal(readRealPropertyPointer(storage), "prop_1");
  assert.deepEqual(storage.keys(), [REAL_PROPERTY_POINTER_KEY]);
  writeRealPropertyPointer(null, storage);
  assert.equal(readRealPropertyPointer(storage), null);
  assert.deepEqual(storage.keys(), []);
});

test("initial real state is an honest empty (no fabricated fix)", () => {
  const state = initialRealPropertyState("2026-08-30T00:00:00.000Z");
  assert.equal(state.currentFix, null);
  assert.deepEqual(state.history, []);
});
