/**
 * Measurement thresholds — explicit, deterministic, env-overridable, per docs §10.3
 * Why each exists:
 * - POSITIVE_CLICKS_PCT 0.10: 10% click increase is outside normal 28-day variance for 500+ impressions
 * - POSITION_IMPROVEMENT 0.7: ~0.7 position is user-visible on page one (e.g., 4.2→3.5)
 * - CTR_IMPROVEMENT_ABSOLUTE 0.002: 0.2pp CTR improvement is material for 2-3% CTR pages
 * - NEGATIVE symmetric thresholds for decline
 * - CONFLICTING threshold: if clicks and position move in opposite directions beyond band, result is ambiguous
 * - INSUFFICIENT impressions <50 or quality missing → insufficient-data
 */

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const measurementConfig = {
  get POSITIVE_CLICKS_PCT(): number {
    return envFloat("RENKO_POSITIVE_CLICKS_PCT", 0.10);
  },
  get NEGATIVE_CLICKS_PCT(): number {
    return envFloat("RENKO_NEGATIVE_CLICKS_PCT", -0.10);
  },
  get POSITION_IMPROVEMENT(): number {
    return envFloat("RENKO_POSITION_IMPROVEMENT", 0.7);
  },
  get POSITION_DECLINE(): number {
    return envFloat("RENKO_POSITION_DECLINE", -0.7);
  },
  get CTR_IMPROVEMENT_ABSOLUTE(): number {
    return envFloat("RENKO_CTR_IMPROVEMENT", 0.002);
  },
  get CTR_DECLINE_ABSOLUTE(): number {
    return envFloat("RENKO_CTR_DECLINE", -0.002);
  },
  get MIN_IMPRESSIONS_FOR_MEASUREMENT(): number {
    return envInt("RENKO_MIN_IMPRESSIONS_MEASUREMENT", 50);
  },
  get CONFLICTING_CLICKS_PCT(): number {
    return envFloat("RENKO_CONFLICTING_CLICKS_PCT", 0.05);
  },
  get CONFLICTING_POSITION_DELTA(): number {
    return envFloat("RENKO_CONFLICTING_POSITION_DELTA", 0.5);
  },
};
