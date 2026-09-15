/**
 * Normalized loading contract (Prompt 5 section 13). Any component that
 * fetches through a SearchDataProvider should represent its lifecycle
 * with this shape instead of inventing ad-hoc booleans/strings per
 * component.
 */
export type LoadingState = "initial-loading" | "refreshing" | "ready" | "error";
