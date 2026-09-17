import { Injectable } from "@nestjs/common";
import {
  SearchConsoleProvider,
  GscSiteEntry,
  GscAnalyticsResponse,
  GscQueryParams,
  Result,
  ok,
  err,
  dataError,
  DataError,
} from "./search-console.provider";

/**
 * InMemoryMockProvider — mirrors lib/data-contract/mock-provider.ts fixtures
 * for tests/CI without real Google credentials. Keeps the same 5 properties
 * as the frontend mock, but with real GSC siteUrl shapes.
 */
@Injectable()
export class InMemoryMockSearchConsoleProvider implements SearchConsoleProvider {
  private readonly fixtures: GscSiteEntry[] = [
    { siteUrl: "sc-domain:example.com", permissionLevel: "siteOwner" },
    { siteUrl: "https://www.example.com/", permissionLevel: "siteFullUser" },
    { siteUrl: "sc-domain:clientsite.com", permissionLevel: "siteFullUser" },
    { siteUrl: "sc-domain:staleclient.com", permissionLevel: "siteFullUser" },
    { siteUrl: "sc-domain:oldproject.com", permissionLevel: "siteUnverifiedUser" },
  ];

  async listProperties(_params: { workspaceId: string; userId: string }): Promise<Result<GscSiteEntry[], never>> {
    // Return deterministic copy; caller upserts to DB and applies permission gating
    return ok([...this.fixtures]);
  }

  async queryAnalytics(params: GscQueryParams): Promise<Result<GscAnalyticsResponse, DataError>> {
    const { siteUrl, dimensions, rowLimit = 25000, startRow = 0 } = params;

    // Simulate permission denied for oldproject
    if (siteUrl.includes("oldproject.com")) {
      return err(dataError("PERMISSION_DENIED", "Mock permission denied for oldproject.com"));
    }

    // Simulate rate limited for specific test site
    if (siteUrl.includes("ratelimited")) {
      return err(dataError("RATE_LIMITED", "Mock rate limited"));
    }

    // For clientsite.com (missing data) return empty
    if (siteUrl.includes("clientsite.com")) {
      return ok({ rows: [], responseAggregationType: "byPage" });
    }

    // Default fixtures for example.com / www.example.com
    // Dimensions handling: support ["page"], ["query"], ["page","query"], ["query","page"]
    const allRows = [
      { keys: ["/pricing", "pricing plans"], clicks: 31, impressions: 1180, ctr: 0.026, position: 4.1 },
      { keys: ["/pricing", "renko pricing"], clicks: 18, impressions: 640, ctr: 0.028, position: 3.9 },
      { keys: ["/pricing", "seo tool cost"], clicks: 12, impressions: 520, ctr: 0.023, position: 4.6 },
      { keys: ["/features", "renko features"], clicks: 34, impressions: 980, ctr: 0.035, position: 3.2 },
      { keys: ["/blog/seo-guide", "seo guide for beginners"], clicks: 41, impressions: 2100, ctr: 0.02, position: 5.8 },
    ];

    // Map dimensions to keys
    let rows: typeof allRows = [];
    if (!dimensions || dimensions.length === 0) {
      // No dimensions → single aggregate row
      rows = [{ keys: [], clicks: 102, impressions: 5840, ctr: 0.017, position: 4.5 }];
    } else if (dimensions.length === 1 && dimensions[0] === "page") {
      // Aggregate per page
      rows = [
        { keys: ["/pricing"], clicks: 61, impressions: 2340, ctr: 0.026, position: 4.2 },
        { keys: ["/features"], clicks: 34, impressions: 980, ctr: 0.035, position: 3.2 },
        { keys: ["/blog/seo-guide"], clicks: 41, impressions: 2100, ctr: 0.02, position: 5.8 },
      ];
    } else if (dimensions.length === 1 && dimensions[0] === "query") {
      rows = allRows.map((r) => ({ keys: [r.keys[1]!], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position }));
    } else if (dimensions.length === 2 && dimensions.includes("page") && dimensions.includes("query")) {
      rows = allRows;
    } else {
      rows = allRows;
    }

    // Pagination
    const paged = rows.slice(startRow, startRow + rowLimit);
    return ok({
      rows: paged.map((r) => ({ keys: r.keys, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
      responseAggregationType: "byPage",
    });
  }
}
