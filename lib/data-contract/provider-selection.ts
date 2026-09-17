/**
 * PROVIDER SELECTION — Prompt 13 §6 (feature flag).
 *
 * The single, centralized place that decides whether the frontend talks to
 * the real NestJS backend (`ApiSearchDataProvider`) or the deterministic
 * in-browser mock (`MockSearchDataProvider`).
 *
 * Flag: `NEXT_PUBLIC_USE_REAL_PROVIDER`
 *   - "true" (or "1") → real API provider
 *   - anything else / unset → mock provider (default)
 *
 * The mock provider MUST remain available and is the default. No component
 * may read `process.env.NEXT_PUBLIC_USE_REAL_PROVIDER` directly — import
 * `isRealProviderEnabled()` (or receive the resolved mode from
 * `AppProviders`, which is the only component that reads this module for
 * rendering decisions).
 */

export type ProviderKind = "mock" | "real";

export function isRealProviderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_USE_REAL_PROVIDER;
  return raw === "true" || raw === "1";
}

export function resolveProviderKind(env: NodeJS.ProcessEnv = process.env): ProviderKind {
  return isRealProviderEnabled(env) ? "real" : "mock";
}
