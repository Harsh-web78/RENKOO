/**
 * Signal thresholds — explicit, documented, deterministic, env-overridable.
 * Why each exists:
 * - MIN_IMPRESSIONS_FOR_CTR: need enough impressions to distinguish signal from noise; below 500, CTR variance is high
 * - CTR_DECLINE_RELATIVE: 15% relative CTR drop is material for user-visible impact
 * - CTR_DECLINE_ABSOLUTE: 0.005 absolute prevents tiny CTR (e.g., 0.001→0.0008) being called a decline
 * - MIN_IMPRESSIONS_FOR_POSITION: position decline needs fewer impressions but still needs stable data
 * - POSITION_DECLINE_THRESHOLD: +1.0 position is roughly one rank on page one — user noticeable
 * - IMPRESSIONS_STABILITY: if impressions changed >30%, decline may be demand shift, not relevance
 * - CONTENT_GAP_MIN_QUERIES: need at least 2 queries to assess intent mismatch
 * - CONTENT_GAP_CTR_THRESHOLD: query CTR <2% with high impressions suggests title not matching intent
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const signalConfig = {
  // CTR below expected
  get MIN_IMPRESSIONS_FOR_CTR(): number {
    return envInt("RENKO_MIN_IMPRESSIONS_CTR", 500);
  },
  get CTR_DECLINE_RELATIVE(): number {
    return envFloat("RENKO_CTR_DECLINE_RELATIVE", 0.15);
  },
  get CTR_DECLINE_ABSOLUTE(): number {
    return envFloat("RENKO_CTR_DECLINE_ABSOLUTE", 0.005);
  },
  get CTR_LOW_ABSOLUTE(): number {
    return envFloat("RENKO_CTR_LOW_ABSOLUTE", 0.03);
  },

  // Position decline
  get MIN_IMPRESSIONS_FOR_POSITION(): number {
    return envInt("RENKO_MIN_IMPRESSIONS_POSITION", 300);
  },
  get POSITION_DECLINE_THRESHOLD(): number {
    return envFloat("RENKO_POSITION_DECLINE_THRESHOLD", 1.0);
  },
  get IMPRESSIONS_STABILITY(): number {
    return envFloat("RENKO_IMPRESSIONS_STABILITY", 0.3);
  },

  // Content relevance gap
  get CONTENT_GAP_MIN_QUERIES(): number {
    return envInt("RENKO_CONTENT_GAP_MIN_QUERIES", 2);
  },
  get CONTENT_GAP_CTR_THRESHOLD(): number {
    return envFloat("RENKO_CONTENT_GAP_CTR_THRESHOLD", 0.02);
  },
  get CONTENT_GAP_IMPRESSIONS(): number {
    return envInt("RENKO_CONTENT_GAP_IMPRESSIONS", 800);
  },
};

export type SignalConfig = typeof signalConfig;
