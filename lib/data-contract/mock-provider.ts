import { dataError, err, ok, type Result, type DataError } from "./errors.ts";
import { addDays, daysAgoIso, makeTrailingPeriod, nowIso } from "./dates.ts";
import type { SearchDataProvider } from "./provider.ts";
import {
  googleSearchConsole,
  type EvidenceQueryRow,
  type Recommendation,
  type RecommendationResult,
  type SearchPageRow,
  type SearchPerformanceSnapshot,
  type SearchPeriod,
  type SearchProperty,
  type SearchQueryRow,
} from "./types.ts";

/**
 * MOCK SEARCH DATA PROVIDER — development only.
 *
 * Implements `SearchDataProvider` with deterministic, hand-seeded data
 * per mock property (the same five properties introduced in Prompt 3's
 * onboarding property list, reused here rather than inventing a parallel
 * set). A real `SearchConsoleDataProvider` replaces this file only —
 * `provider.ts`'s interface and every type in `types.ts` stay the same.
 */

const exampleComProperty: SearchProperty = { id: "example.com", name: "example.com", type: "domain" };
const wwwExampleComProperty: SearchProperty = { id: "www.example.com", name: "www.example.com", type: "url-prefix" };
const clientsiteProperty: SearchProperty = { id: "clientsite.com", name: "clientsite.com", type: "domain" };
const staleclientProperty: SearchProperty = { id: "staleclient.com", name: "staleclient.com", type: "domain" };
const oldprojectProperty: SearchProperty = { id: "oldproject.com", name: "oldproject.com", type: "domain" };

const properties: SearchProperty[] = [
  exampleComProperty,
  wwwExampleComProperty,
  clientsiteProperty,
  staleclientProperty,
  oldprojectProperty,
];

export function formatCtr(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function toEvidenceRow(row: SearchQueryRow): EvidenceQueryRow {
  return {
    query: row.query,
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: formatCtr(row.ctr),
    position: row.position.toFixed(1),
  };
}

function pageRow(page: string, clicks: number, impressions: number, ctr: number, position: number): SearchPageRow {
  return { page, clicks, impressions, ctr, position };
}

/** example.com's default recommendation — used only if the caller has no onboarding-sourced override. */
function exampleComRecommendation(period: SearchPeriod): Recommendation {
  const snapshot: SearchPerformanceSnapshot = {
    meta: {
      source: googleSearchConsole,
      property: exampleComProperty,
      period,
      dataThrough: period.end,
      retrievedAt: nowIso(),
      freshness: "fresh",
      quality: "complete",
      limitations: [],
    },
    page: pageRow("/pricing", 74, 2840, 0.026, 4.2),
    comparisonPage: pageRow("/pricing", 112, 2760, 0.041, 1.8),
    queries: [
      { query: "pricing plans", clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 },
      { query: "renko pricing", clicks: 18, impressions: 640, ctr: 0.028, position: 3.9 },
      { query: "seo tool cost", clicks: 12, impressions: 520, ctr: 0.023, position: 4.6 },
    ],
  };
  return {
    id: "example.com::fix-live",
    page: "/pricing",
    signal: "ctr-below-expected",
    finding: "This page is receiving strong impressions but fewer clicks than expected for its current position.",
    interpretation:
      "The page is still earning meaningful visibility, but it's converting less of that visibility into clicks than it used to.",
    recommendedAction: "Rewrite the page title to match the search intent more directly.",
    rationale:
      "The page receives meaningful impressions for its main query, but its click-through rate is weaker than expected at this position.",
    snapshot,
    evidence: { rows: snapshot.queries.map(toEvidenceRow) },
    limitations: [],
  };
}

function wwwExampleComRecommendation(period: SearchPeriod): Recommendation {
  const snapshot: SearchPerformanceSnapshot = {
    meta: {
      source: googleSearchConsole,
      property: wwwExampleComProperty,
      period,
      dataThrough: period.end,
      retrievedAt: nowIso(),
      freshness: "fresh",
      quality: "complete",
      limitations: [],
    },
    page: pageRow("/blog/seo-guide", 60, 3400, 0.018, 5.9),
    comparisonPage: pageRow("/blog/seo-guide", 73, 3300, 0.022, 4.3),
    queries: [
      { query: "seo guide for beginners", clicks: 41, impressions: 2100, ctr: 0.02, position: 5.8 },
      { query: "how to improve seo", clicks: 19, impressions: 980, ctr: 0.019, position: 6.2 },
    ],
  };
  return {
    id: "www.example.com::fix-live",
    page: "/blog/seo-guide",
    signal: "position-decline",
    finding: "This guide still ranks on page one but has slipped several positions over the comparison window.",
    interpretation: "The page hasn't lost its ranking entirely, but it's slipping below competing results for its main query.",
    recommendedAction: "Expand the introduction to more directly answer the primary query in the first 100 words.",
    rationale:
      "Position moved from 4.3 to 5.9 while impressions held steady, suggesting a content-relevance gap rather than a demand drop.",
    snapshot,
    evidence: { rows: snapshot.queries.map(toEvidenceRow) },
    limitations: [],
  };
}

function getPerformanceSnapshotSync(
  propertyId: string,
  period: SearchPeriod
): Result<SearchPerformanceSnapshot, DataError> {
  const property = properties.find((p) => p.id === propertyId);
  if (!property) return err(dataError("PROPERTY_NOT_FOUND", `No property found for "${propertyId}".`));

  if (propertyId === "example.com") return ok(exampleComRecommendation(period).snapshot);
  if (propertyId === "www.example.com") return ok(wwwExampleComRecommendation(period).snapshot);

  if (propertyId === "clientsite.com") {
    return ok({
      meta: {
        source: googleSearchConsole,
        property,
        period,
        dataThrough: period.end,
        retrievedAt: nowIso(),
        freshness: "fresh",
        quality: "missing",
        limitations: ["Not enough indexed search activity yet to compute a reliable comparison."],
      },
      page: pageRow("/", 0, 0, 0, 0),
      queries: [],
    });
  }

  if (propertyId === "staleclient.com") {
    const lastGood = daysAgoIso(9);
    return ok({
      meta: {
        source: googleSearchConsole,
        property,
        period,
        dataThrough: lastGood,
        retrievedAt: nowIso(),
        freshness: "stale",
        quality: "delayed",
        limitations: ["Search Console hasn't reported new data in over a week."],
      },
      page: pageRow("/", 0, 0, 0, 0),
      queries: [],
    });
  }

  if (propertyId === "oldproject.com") {
    return err(dataError("UPSTREAM_ERROR", "RENKO couldn't reach Search Console for this property."));
  }

  return err(dataError("UNKNOWN_ERROR", "Unrecognized property."));
}

function getRecommendationResultSync(propertyId: string, period: SearchPeriod): RecommendationResult {
  if (propertyId === "example.com") {
    return { status: "recommendation-available", recommendation: exampleComRecommendation(period) };
  }
  if (propertyId === "www.example.com") {
    return { status: "recommendation-available", recommendation: wwwExampleComRecommendation(period) };
  }

  const snapshotResult = getPerformanceSnapshotSync(propertyId, period);

  if (!snapshotResult.ok) {
    // An upstream/connection failure means no defensible recommendation
    // can be produced — never fabricate one to fill the slot.
    return { status: "unavailable", meta: undefined };
  }

  const { meta } = snapshotResult.data;
  if (meta.quality === "missing") {
    return { status: "insufficient-data", meta };
  }
  if (meta.freshness === "stale") {
    return { status: "stale-data", meta };
  }
  return { status: "no-signal", meta };
}

export const MockSearchDataProvider: SearchDataProvider = {
  async getProperties(): Promise<Result<SearchProperty[], DataError>> {
    return ok(properties);
  },

  async getPerformanceSnapshot(
    propertyId: string,
    period: SearchPeriod = makeTrailingPeriod(28)
  ): Promise<Result<SearchPerformanceSnapshot, DataError>> {
    return getPerformanceSnapshotSync(propertyId, period);
  },

  async getRecommendationResult(propertyId: string): Promise<RecommendationResult> {
    return getRecommendationResultSync(propertyId, makeTrailingPeriod(28));
  },
};

/**
 * Synchronous core, exported for `lib/mock/product-service.ts`'s existing
 * synchronous seeding path (session-context persists state via React's
 * synchronous functional setState — see the comment there). The mock has
 * no real I/O latency, so the async interface above and this synchronous
 * core compute the identical result; only a real backend would need the
 * async path to mean something.
 */
export const mockProviderSync = {
  getRecommendationResult: getRecommendationResultSync,
  getPerformanceSnapshot: getPerformanceSnapshotSync,
};

/** Re-exported for tests and adapters that need a period without importing dates.ts directly. */
export { addDays };
