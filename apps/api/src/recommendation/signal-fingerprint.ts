import { createHash } from "node:crypto";

/**
 * Signal fingerprint (Prompt 2 — Remember layer).
 *
 * A deterministic SHA-256 hash over the *material evidence* behind one
 * recommendation, used to decide whether a dismissed recommendation is
 * resurfacing with identical evidence (suppress) or genuinely new evidence
 * (new Fix). Pure function: no DB, no engine changes, no I/O.
 *
 * Included (identity + evidence-driving values):
 *   - workspaceId / propertyId / page / signal (memory scope; the DB lookup
 *     is already scoped by these, the hash carries them so a fingerprint is
 *     self-describing and can never collide across scopes)
 *   - current page row: clicks, impressions, ctr, position
 *   - prior (comparison) page row, when present (the decline itself is evidence)
 *   - evidence query rows in order: query, clicks, impressions, ctr, position
 *
 * Excluded (deliberately NOT fingerprinted):
 *   - timestamps of any kind (retrievedAt, snapshot periods, createdAt)
 *   - snapshot period start/end (a new period with identical evidence is the
 *     SAME opportunity, not a new one)
 *   - database row ids (snapshot/recommendation ids change per incarnation)
 *   - generated prose (finding/interpretation/action/rationale may be
 *     reworded without evidence changing)
 *   - limitations, quality/freshness labels, siteUrl
 *
 * Stability notes:
 *   - floats are rounded (ctr 6dp, position 3dp) — far below engine
 *     materiality (CTR_DECLINE_ABSOLUTE 0.005, POSITION_DECLINE_THRESHOLD
 *     1.0), so rounding only absorbs float-repr dust, never real changes.
 *   - `v: 1` versions the algorithm: a future algorithm change yields
 *     different hashes, which safely fail open (treated as new evidence).
 */

export interface FingerprintPageRow {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface FingerprintQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number | string;
  position: number | string;
}

export interface SignalFingerprintInput {
  workspaceId: string;
  propertyId: string;
  page: string;
  /** Dash form ("ctr-below-expected"); underscore form is normalized. */
  signal: string;
  current: FingerprintPageRow;
  prior: FingerprintPageRow | null;
  queries: FingerprintQueryRow[];
}

function round6(n: number): number {
  return Number(Number(n).toFixed(6));
}

function round3(n: number): number {
  return Number(Number(n).toFixed(3));
}

function canonQuery(q: FingerprintQueryRow): Record<string, unknown> {
  return {
    query: q.query,
    clicks: q.clicks,
    impressions: q.impressions,
    // Evidence rows may already be formatted strings ("2.6%"/"4.1") as
    // persisted by the engine; pass them through verbatim so live and
    // backfilled computations agree byte-for-byte.
    ctr: typeof q.ctr === "number" ? round6(q.ctr) : q.ctr,
    position: typeof q.position === "number" ? round3(q.position) : q.position,
  };
}

/**
 * Returns the hex SHA-256 fingerprint, or null when the input is malformed
 * (missing pieces). Null means "unknown" — callers must fail open (treat as
 * new evidence), never suppress on it.
 */
export function computeSignalFingerprint(input: SignalFingerprintInput): string | null {
  try {
    if (!input || typeof input !== "object") return null;
    const { workspaceId, propertyId, page, signal, current, prior, queries } = input;
    if (!workspaceId || !propertyId || !page || !signal) return null;
    if (!current || typeof current !== "object") return null;
    if (!Array.isArray(queries)) return null;
    for (const n of [current.clicks, current.impressions, current.ctr, current.position]) {
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
    }
    if (prior !== null && prior !== undefined) {
      if (typeof prior !== "object") return null;
      for (const n of [prior.clicks, prior.impressions, prior.ctr, prior.position]) {
        if (typeof n !== "number" || !Number.isFinite(n)) return null;
      }
    }

    const canonical = {
      v: 1,
      workspaceId,
      propertyId,
      page,
      signal: signal.replace(/_/g, "-"),
      current: {
        clicks: current.clicks,
        impressions: current.impressions,
        ctr: round6(current.ctr),
        position: round3(current.position),
      },
      prior:
        prior === null || prior === undefined
          ? null
          : {
              clicks: prior.clicks,
              impressions: prior.impressions,
              ctr: round6(prior.ctr),
              position: round3(prior.position),
            },
      queries: queries.map(canonQuery),
    };
    return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  } catch {
    return null;
  }
}
