/**
 * Normalized error contract (Prompt 5 section 12). Any data provider —
 * mock or real — communicates failure through this shape. Components
 * branch on `code`, never on a raw provider error string or stack trace.
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
  | "UNKNOWN_ERROR";

export interface DataError {
  code: DataErrorCode;
  /** User-safe message only — never a stack trace or raw provider payload. */
  message: string;
}

export function dataError(code: DataErrorCode, message: string): DataError {
  return { code, message };
}

/**
 * A minimal Result type so providers can return "ok or a normalized
 * error" without throwing. Kept intentionally tiny — this is a typed
 * seam, not a dependency.
 */
export type Result<T, E = DataError> = { ok: true; data: T } | { ok: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E = DataError>(error: E): Result<never, E> {
  return { ok: false, error };
}
