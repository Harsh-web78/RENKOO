/**
 * Date utilities for GSC ingestion — PT (America/Los_Angeles) handling per docs §4.5, §7.2
 */

export function toPtDateString(date: Date): string {
  // Format as YYYY-MM-DD in PT
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export interface PtPeriod {
  startPt: string; // YYYY-MM-DD PT
  endPt: string; // YYYY-MM-DD PT
  startIso: string; // inclusive ISO UTC
  endIso: string;
  label: string;
}

/**
 * Make trailing N-day period ending at now (PT). For RENKO, N=28.
 * Current period: last 28 days inclusive.
 * Prior period: preceding 28 days.
 */
export function makeTrailingPtPeriod(days: number, now: Date = new Date()): PtPeriod {
  // End is yesterday PT? GSC dataThrough is PT, and final data lags 2-3 days, but for period we use PT today as end
  // For simplicity, use now in PT for endPt
  const endPt = toPtDateString(now);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - (days - 1));
  const startPt = toPtDateString(startDate);

  // ISO versions for meta (UTC midnight)
  const endIso = new Date(endPt + "T00:00:00Z").toISOString();
  const startIso = new Date(startPt + "T00:00:00Z").toISOString();

  return {
    startPt,
    endPt,
    startIso,
    endIso,
    label: `Last ${days} days vs. prior ${days} days`,
  };
}

export function makePriorPtPeriod(current: PtPeriod, days: number): PtPeriod {
  const currentStart = new Date(current.startIso);
  const priorEndDate = new Date(currentStart);
  priorEndDate.setUTCDate(priorEndDate.getUTCDate() - 1);
  const priorStartDate = new Date(priorEndDate);
  priorStartDate.setUTCDate(priorStartDate.getUTCDate() - (days - 1));

  const priorEndPt = toPtDateString(priorEndDate);
  const priorStartPt = toPtDateString(priorStartDate);

  return {
    startPt: priorStartPt,
    endPt: priorEndPt,
    startIso: new Date(priorStartPt + "T00:00:00Z").toISOString(),
    endIso: new Date(priorEndPt + "T00:00:00Z").toISOString(),
    label: `Prior ${days} days`,
  };
}

export function isOutsideSixteenMonths(startIso: string, now: Date = new Date()): boolean {
  const start = new Date(startIso).getTime();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 16);
  cutoff.setDate(cutoff.getDate() - 5); // buffer
  return start < cutoff.getTime();
}
