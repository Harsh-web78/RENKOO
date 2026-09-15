import type { SearchPeriod } from "./types.ts";

/**
 * Canonical date utilities (Prompt 5 section 11). Every place in the
 * product that needs to add days, format a date for display, or build a
 * comparison period should import from here rather than recomputing date
 * math locally. Formatting uses a fixed locale/timezone (UTC, en-US)
 * deliberately — display formatting must never change the underlying
 * date semantics (e.g. what "data through" actually means).
 */

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export function daysAgoIso(days: number, from: string = nowIso()): string {
  return addDays(from, -days);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso)
  );
}

/** Builds a canonical trailing N-day period ending on `end` (defaults to now), with a human label. */
export function makeTrailingPeriod(days: number, end: string = nowIso(), label?: string): SearchPeriod {
  return {
    start: daysAgoIso(days, end),
    end,
    label: label ?? `Last ${days} days vs. prior ${days} days`,
  };
}
