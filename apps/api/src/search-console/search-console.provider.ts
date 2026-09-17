/**
 * SearchConsoleProvider — server-side port of lib/data-contract/provider.ts
 * per docs §6.1. Never exposes Google SDK types to callers.
 */

export type DataErrorCode =
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "PROPERTY_NOT_FOUND"
  | "NO_DATA"
  | "INSUFFICIENT_DATA"
  | "STALE_DATA"
  | "PARTIAL_DATA"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "UNKNOWN_ERROR"
  | "VALIDATION_ERROR"
  | "DATA_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface DataError {
  code: DataErrorCode;
  message: string;
}

export type Result<T, E = DataError> = { ok: true; data: T } | { ok: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function dataError(code: DataErrorCode, message: string): DataError {
  return { code, message };
}

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser";
}

export interface GscAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscAnalyticsResponse {
  rows?: GscAnalyticsRow[];
  responseAggregationType?: string;
}

export interface GscQueryParams {
  workspaceId: string;
  siteUrl: string;
  startDate: string; // YYYY-MM-DD PT
  endDate: string; // YYYY-MM-DD PT
  dimensions?: string[];
  rowLimit?: number;
  startRow?: number;
  dataState?: string;
  type?: string;
  aggregationType?: string;
}

export interface SearchConsoleProvider {
  /**
   * List GSC sites for the workspace's connected Google account.
   * Must decrypt and refresh token internally, never log tokens.
   */
  listProperties(params: { workspaceId: string; userId: string }): Promise<Result<GscSiteEntry[], DataError>>;

  /**
   * Query Search Analytics (raw). Must handle pagination, validation, rate limiting internally.
   */
  queryAnalytics(params: GscQueryParams): Promise<Result<GscAnalyticsResponse, DataError>>;
}

export const SEARCH_CONSOLE_PROVIDER = Symbol("SEARCH_CONSOLE_PROVIDER");
