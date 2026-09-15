import type { Result, DataError } from "./errors.ts";
import type { RecommendationResult, SearchPerformanceSnapshot, SearchPeriod, SearchProperty } from "./types.ts";

/**
 * BACKEND-READY SEAM (Prompt 5 section 17).
 *
 * `MockSearchDataProvider` (mock-provider.ts) is the only implementation
 * today. A future `SearchConsoleDataProvider` — backed by a real OAuth
 * connection and the real Search Console API — should implement this
 * exact interface. Nothing above this seam (session-context, Home,
 * Fixes, History, EvidenceDrawer) should need to change when that
 * happens; only the object passed into `lib/mock/product-service.ts`
 * changes.
 */
export interface SearchDataProvider {
  getProperties(): Promise<Result<SearchProperty[], DataError>>;

  getPerformanceSnapshot(propertyId: string, period?: SearchPeriod): Promise<Result<SearchPerformanceSnapshot, DataError>>;

  /**
   * "What's the one thing worth working on next for this property?" —
   * always resolves to one of RecommendationResult's honest outcomes,
   * never throws for a normal "nothing found" case (only for genuine
   * transport/programmer errors, which callers should still guard).
   */
  getRecommendationResult(propertyId: string): Promise<RecommendationResult>;
}
