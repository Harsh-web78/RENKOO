import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RecommendationEngine } from "./recommendation.engine";
import type { Recommendation as EngineRecommendation } from "./recommendation.engine";
import { measurementConfig } from "./measurement-config";
import {
  computeSignalFingerprint,
  type FingerprintPageRow,
  type FingerprintQueryRow,
} from "./signal-fingerprint";
import type { SearchPerformanceSnapshot } from "../ingestion/search-data.normalizer";

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly engine = new RecommendationEngine();

  constructor(private readonly prisma: PrismaService) {}

  private toFixStatus(status: string): "available" | "reviewed" | "applied" | "dismissed" | "superseded" {
    // Map FixApplyStatus enum values to string (Prompt 2 adds `superseded`:
    // a previous available/reviewed incarnation replaced by genuinely new
    // evidence for the same property/page/signal).
    return status as any;
  }

  /**
   * Strips the internal canonical GSC identifier (`siteUrl`) from snapshot
   * provenance before it leaves the API. Mirrors the `sanitizeSnapshot`
   * pattern in `history.service.ts`: the frontend contract
   * (`SearchProperty`) has no `siteUrl` field — it stays server-side.
   * Stored rows are never mutated; only response-bound copies are shaped.
   */
  private sanitizeMeta<T>(meta: T): T {
    const m = meta as unknown as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") return meta;
    const property = m.property as Record<string, unknown> | undefined;
    if (!property || typeof property !== "object" || !("siteUrl" in property)) return meta;
    const { siteUrl: _dropped, ...restProperty } = property as Record<string, unknown> & { siteUrl?: unknown };
    void _dropped;
    return { ...m, property: restProperty } as unknown as T;
  }

  private sanitizeSnapshot<T>(snapshot: T): T {
    const s = snapshot as unknown as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object" || !("meta" in s)) return snapshot;
    return { ...s, meta: this.sanitizeMeta(s.meta) } as unknown as T;
  }

  /**
   * Remember layer (Prompt 2) helpers.
   *
   * Fix rows carry no signal column, so a "lineage" (same workspace +
   * property + page + signal) is resolved in code: fetch the property/page
   * fixes newest-first, join each to its Recommendation row, keep the ones
   * whose signal matches (dash-normalized). Volumes per page are tiny.
   */

  private dashSignal(signal: string | null | undefined): string | null {
    if (!signal || typeof signal !== "string") return null;
    return signal.replace(/_/g, "-");
  }

  private pageRowOf(value: unknown): FingerprintPageRow | null {
    const r = value as Record<string, unknown> | null | undefined;
    if (!r || typeof r !== "object") return null;
    const { clicks, impressions, ctr, position } = r as Record<string, unknown>;
    if (
      typeof clicks !== "number" ||
      typeof impressions !== "number" ||
      typeof ctr !== "number" ||
      typeof position !== "number"
    ) {
      return null;
    }
    return { clicks, impressions, ctr, position };
  }

  private queriesOf(value: unknown): FingerprintQueryRow[] | null {
    const rows = (value as { rows?: unknown } | null | undefined)?.rows;
    if (!Array.isArray(rows)) return null;
    const out: FingerprintQueryRow[] = [];
    for (const q of rows) {
      const row = q as Record<string, unknown>;
      if (!row || typeof row !== "object" || typeof row.query !== "string") return null;
      if (typeof row.clicks !== "number" || typeof row.impressions !== "number") return null;
      if ((typeof row.ctr !== "number" && typeof row.ctr !== "string") || (typeof row.position !== "number" && typeof row.position !== "string")) {
        return null;
      }
      out.push({ query: row.query, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position });
    }
    return out;
  }

  /** Fingerprint for a live engine recommendation (persistence layer input). */
  private fingerprintForEngineRec(params: { workspaceId: string; propertyId: string; rec: EngineRecommendation }): string | null {
    const { workspaceId, propertyId, rec } = params;
    const snapshot = rec.snapshot as unknown as Record<string, unknown>;
    const current = this.pageRowOf((snapshot as { page?: unknown }).page);
    const priorRaw = (snapshot as { comparisonPage?: unknown }).comparisonPage;
    const prior = priorRaw === undefined || priorRaw === null ? null : this.pageRowOf(priorRaw);
    if (priorRaw !== undefined && priorRaw !== null && prior === null) return null;
    const queries = this.queriesOf(rec.evidence);
    if (!current || queries === null) return null;
    return computeSignalFingerprint({ workspaceId, propertyId, page: rec.page, signal: rec.signal, current, prior, queries });
  }

  /** Fingerprint recomputed from a persisted Recommendation row (NULL backfill). */
  private fingerprintForStoredRec(params: { workspaceId: string; propertyId: string; rec: { page: string; signal: string; evidenceJson: unknown; snapshotJson: unknown } }): string | null {
    const { workspaceId, propertyId, rec } = params;
    const snapshot = rec.snapshotJson as unknown as Record<string, unknown> | null | undefined;
    if (!snapshot || typeof snapshot !== "object") return null;
    const current = this.pageRowOf((snapshot as { page?: unknown }).page);
    const priorRaw = (snapshot as { comparisonPage?: unknown }).comparisonPage;
    const prior = priorRaw === undefined || priorRaw === null ? null : this.pageRowOf(priorRaw);
    if (priorRaw !== undefined && priorRaw !== null && prior === null) return null;
    const queries = this.queriesOf(rec.evidenceJson);
    if (!current || queries === null) return null;
    return computeSignalFingerprint({ workspaceId, propertyId, page: rec.page, signal: rec.signal, current, prior, queries });
  }

  private async lineageFixes(params: { workspaceId: string; propertyId: string; page: string; signalDash: string }): Promise<Array<{ fix: any; rec: any | null }>> {
    const { workspaceId, propertyId, page, signalDash } = params;
    const fixes = await this.prisma.fix.findMany({
      where: { workspaceId, propertyId, page },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const out: Array<{ fix: any; rec: any | null }> = [];
    for (const fix of fixes) {
      let rec: any | null = null;
      if (fix.recommendationId) {
        rec = await this.prisma.recommendation.findUnique({ where: { id: fix.recommendationId } });
      }
      // Scope is strictly same-signal: rows without a resolvable same-signal
      // recommendation can neither suppress nor be superseded (fail open).
      if (!rec || this.dashSignal(rec.signal as string) !== signalDash) continue;
      out.push({ fix, rec });
    }
    return out;
  }

  /**
   * Resolve the effective fingerprint of a lineage fix: stored value, else
   * recompute from its persisted Recommendation (Prompt 1 legacy NULL
   * backfill — the first post-Prompt-2 read establishes it), else null
   * ("unknown" — callers must fail open, never suppress on it).
   */
  private async resolveFixFingerprint(entry: { fix: any; rec: any | null }): Promise<string | null> {
    const { fix, rec } = entry;
    if (fix.signalFingerprint && typeof fix.signalFingerprint === "string") return fix.signalFingerprint;
    if (!rec) return null;
    const recomputed = this.fingerprintForStoredRec({ workspaceId: fix.workspaceId, propertyId: fix.propertyId, rec });
    if (!recomputed) return null;
    await this.prisma.fix.update({ where: { id: fix.id }, data: { signalFingerprint: recomputed } }).catch(() => {});
    this.logger.log(`Backfilled signalFingerprint for Fix ${fix.id} (property ${fix.propertyId})`);
    return recomputed;
  }

  async getRecommendation(params: {
    workspaceId: string;
    propertyId: string;
  }): Promise<{ status: string; recommendation?: any; meta?: any; snapshot?: SearchPerformanceSnapshot }> {
    const { workspaceId, propertyId } = params;

    // Find latest snapshot
    const snapshotRow = await this.prisma.searchDataSnapshot.findFirst({
      where: { workspaceId, propertyId },
      orderBy: { retrievedAt: "desc" },
    });

    if (!snapshotRow) {
      return { status: "unavailable", meta: undefined };
    }

    const snapshot = snapshotRow.normalizedJson as unknown as SearchPerformanceSnapshot;
    // Evaluate pure engine
    const result = this.engine.evaluate(snapshot);

    // Map engine status to honest result
    if (result.status !== "recommendation-available" || !result.recommendation) {
      return { status: result.status, meta: result.meta ? this.sanitizeMeta(result.meta) : undefined };
    }

    const rec = result.recommendation;
    const signalDash = this.dashSignal(rec.signal) ?? rec.signal;

    // Remember layer (Prompt 2): fingerprint the current evidence. A null
    // here means the engine output was malformed (unreachable in practice);
    // fail open to the pre-Prompt-2 behavior below.
    const fingerprint = this.fingerprintForEngineRec({ workspaceId, propertyId, rec });

    // Same-scope lineage, newest first (same workspace/property/page/signal;
    // other pages/signals/properties/workspaces never participate).
    const lineage = await this.lineageFixes({ workspaceId, propertyId, page: rec.page, signalDash });
    const activeLineage = lineage.filter(({ fix }) => fix.status === "available" || fix.status === "reviewed" || fix.status === "applied");

    // Idempotency: reuse the current active incarnation when it already
    // carries this exact evidence — same fingerprint regardless of period
    // (Case 3: new period, identical evidence), or the legacy same-period +
    // same-signal match for rows whose fingerprint cannot be resolved.
    const latestActive = activeLineage[0];
    if (latestActive) {
      const activeFp = await this.resolveFixFingerprint(latestActive);
      const existingRec = latestActive.rec;
      let reuse = false;
      if (activeFp && fingerprint && activeFp === fingerprint) {
        reuse = true;
      } else if (existingRec) {
        const existingSnapshot = existingRec.snapshotJson as unknown as SearchPerformanceSnapshot;
        const existingSignalDash = this.dashSignal(existingRec.signal as string);
        if (
          existingSnapshot?.meta?.period?.start === snapshot.meta.period.start &&
          existingSnapshot?.meta?.period?.end === snapshot.meta.period.end &&
          existingSignalDash === rec.signal
        ) {
          reuse = true;
        }
      }
      if (reuse && existingRec) {
        // Reuse — return existing recommendation as persisted
        this.logger.log(`Reuse existing Fix ${latestActive.fix.id} for property ${propertyId}`);
        return {
          status: "recommendation-available",
          recommendation: {
            id: existingRec.id,
            page: existingRec.page,
            signal: (existingRec.signal as string).replace(/_/g, "-"),
            finding: existingRec.finding,
            interpretation: existingRec.interpretation,
            recommendedAction: existingRec.recommendedAction,
            rationale: existingRec.rationale,
            snapshot: this.sanitizeSnapshot(existingRec.snapshotJson),
            evidence: existingRec.evidenceJson,
            limitations: existingRec.limitations,
          },
          meta: this.sanitizeMeta(snapshot.meta),
          snapshot: this.sanitizeSnapshot(snapshot),
        };
      }
    }

    // Dismissed suppression (Prompt 2 — Remember): the latest dismissed
    // incarnation of this lineage remembers its evidence. Same fingerprint
    // → the opportunity was already decided; surface the honest remembered
    // no-signal state. No mutation of the dismissed row, no new rows.
    // Different fingerprint (or unresolvable legacy row) → genuinely new
    // evidence (or fail-open) → fall through to creation below.
    if (fingerprint) {
      const latestDismissed = lineage.find(({ fix }) => fix.status === "dismissed");
      if (latestDismissed) {
        const dismissedFp = await this.resolveFixFingerprint(latestDismissed);
        if (dismissedFp && dismissedFp === fingerprint) {
          this.logger.log(`Remembering dismissed Fix ${latestDismissed.fix.id} for property ${propertyId} (same evidence)`);
          return { status: "no-signal", meta: this.sanitizeMeta(snapshot.meta) };
        }
      }
    }

    // Acknowledged suppression (lifecycle rule R5): an actioned signal does
    // not resurface while the same snapshot still carries it. Only fresh
    // data (a different snapshot period) may surface a new recommendation.
    // Surfaced as no-signal with meta: there is nothing *new* worth doing,
    // which is what the UI renders — never a fabricated recommendation.
    const acknowledgedFix = await this.prisma.fix.findFirst({
      where: { workspaceId, propertyId, page: rec.page, status: "acknowledged" },
      orderBy: { createdAt: "desc" },
    });
    if (acknowledgedFix?.recommendationId) {
      const acknowledgedRec = await this.prisma.recommendation.findUnique({
        where: { id: acknowledgedFix.recommendationId },
      });
      const acknowledgedSnapshot = acknowledgedRec?.snapshotJson as unknown as SearchPerformanceSnapshot | undefined;
      const acknowledgedSignal = (acknowledgedRec?.signal as string | undefined)?.replace(/_/g, "-");
      if (
        acknowledgedSnapshot?.meta?.period?.start === snapshot.meta.period.start &&
        acknowledgedSnapshot?.meta?.period?.end === snapshot.meta.period.end &&
        acknowledgedSignal === rec.signal
      ) {
        this.logger.log(`Suppressing acknowledged signal for Fix ${acknowledgedFix.id} (property ${propertyId})`);
        return { status: "no-signal", meta: this.sanitizeMeta(snapshot.meta) };
      }
    }

    // Need to create new Recommendation + Fix. Reaching here means the
    // current evidence is genuinely new for this lineage: no active
    // incarnation carries it (else reuse above) and no dismissed incarnation
    // remembers it (else suppression above). Applied/measured rows are
    // history and are never touched; previous available/reviewed incarnations
    // of this same lineage are superseded so they can neither resurface as
    // current nor linger as invisible active orphans. Dismissed/acknowledged
    // rows are never rewritten.

    const recommendation = await this.prisma.recommendation.create({
      data: {
        workspaceId,
        propertyId,
        snapshotId: snapshotRow.id,
        signal: rec.signal.replace(/-/g, "_") as any,
        page: rec.page,
        pageUrl: `https://placeholder${rec.page}`, // pageUrl not critical for test, use path
        finding: rec.finding,
        interpretation: rec.interpretation,
        recommendedAction: rec.recommendedAction,
        rationale: rec.rationale,
        evidenceJson: rec.evidence as any,
        snapshotJson: snapshot as any,
        limitations: rec.limitations,
        status: "recommendation_available",
      },
    });

    const fix = await this.prisma.fix.create({
      data: {
        workspaceId,
        propertyId,
        recommendationId: recommendation.id,
        page: rec.page,
        status: "available",
        measurementWindowDays: 14,
        signalFingerprint: fingerprint,
      },
    });

    // Supersede previous available/reviewed incarnations of this lineage
    // (same workspace/property/page/signal, different evidence). Terminal,
    // system-written, truthful: never a dismissal, never an apply. Invisible
    // by default — getFix/history whitelist active/history statuses only.
    const staleIds = activeLineage
      .filter(({ fix: prev }) => (prev.status === "available" || prev.status === "reviewed") && prev.id !== fix.id)
      .map(({ fix: prev }) => prev.id as string);
    if (staleIds.length > 0) {
      await this.prisma.fix.updateMany({ where: { id: { in: staleIds } }, data: { status: "superseded" } });
      this.logger.log(`Superseded ${staleIds.length} prior Fix incarnation(s) for property ${propertyId} (new evidence)`);
    }

    this.logger.log(`Created Recommendation ${recommendation.id} Fix ${fix.id} for property ${propertyId}`);

    return {
      status: "recommendation-available",
      recommendation: {
        id: recommendation.id,
        page: recommendation.page,
        signal: (recommendation.signal as string).replace(/_/g, "-"),
        finding: recommendation.finding,
        interpretation: recommendation.interpretation,
        recommendedAction: recommendation.recommendedAction,
        rationale: recommendation.rationale,
        snapshot: this.sanitizeSnapshot(recommendation.snapshotJson),
        evidence: recommendation.evidenceJson,
        limitations: recommendation.limitations,
      },
      meta: this.sanitizeMeta(snapshot.meta),
      snapshot: this.sanitizeSnapshot(snapshot),
    };
  }

  async getFix(params: { workspaceId: string; propertyId: string }): Promise<any | null> {
    const fix = await this.prisma.fix.findFirst({
      where: { workspaceId: params.workspaceId, propertyId: params.propertyId, status: { in: ["available", "reviewed", "applied"] } },
      orderBy: { createdAt: "desc" },
      include: { outcome: true },
    });
    if (!fix) return null;
    const rec = fix.recommendationId
      ? await this.prisma.recommendation.findUnique({ where: { id: fix.recommendationId } })
      : null;
    return {
      id: fix.id,
      page: fix.page,
      status: fix.status,
      dismissReason: fix.dismissReason,
      baseline: fix.baselineCapturedAt
        ? { clicks: fix.baselineClicks, ctr: fix.baselineCtr, position: fix.baselinePosition, capturedAt: fix.baselineCapturedAt }
        : undefined,
      appliedAt: fix.appliedAt,
      expectedMeasurementDate: fix.expectedMeasurementDate,
      measurementWindowDays: fix.measurementWindowDays,
      outcome: fix.outcome,
      recommendation: rec
        ? {
            id: rec.id,
            page: rec.page,
            signal: (rec.signal as string).replace(/_/g, "-"),
            finding: rec.finding,
            interpretation: rec.interpretation,
            recommendedAction: rec.recommendedAction,
            rationale: rec.rationale,
            snapshot: this.sanitizeSnapshot(rec.snapshotJson),
            evidence: rec.evidenceJson,
          }
        : null,
    };
  }

  private async ensureFixOwned(workspaceId: string, propertyId: string, fixId: string) {
    const fix = await this.prisma.fix.findFirst({ where: { id: fixId, workspaceId, propertyId } });
    if (!fix) {
      // Use HttpException so controller returns 404, not 500
      const { HttpException, HttpStatus } = await import("@nestjs/common");
      throw new HttpException({ code: "PROPERTY_NOT_FOUND", message: "Fix not found in this workspace/property." }, HttpStatus.NOT_FOUND);
    }
    return fix;
  }

  async reviewFix(params: { workspaceId: string; propertyId: string; fixId: string }): Promise<any> {
    const fix = await this.ensureFixOwned(params.workspaceId, params.propertyId, params.fixId);
    if (fix.status !== "available") {
      return fix; // idempotent
    }
    return this.prisma.fix.update({ where: { id: fix.id }, data: { status: "reviewed" } });
  }

  async applyFix(params: { workspaceId: string; propertyId: string; fixId: string }): Promise<any> {
    const fix = await this.ensureFixOwned(params.workspaceId, params.propertyId, params.fixId);
    if (fix.status === "applied") return fix;
    if (fix.status === "dismissed" || fix.status === "acknowledged") {
      // PROMPT 7 (P1): invalid lifecycle transition must be a typed 409, not
      // a raw 500 — the frontend distinguishes INVALID_TRANSITION to show an
      // actionable message instead of a generic internal error.
      throw new HttpException(
        { code: "INVALID_TRANSITION", message: "Cannot apply a dismissed or acknowledged fix." },
        HttpStatus.CONFLICT,
      );
    }
    const now = new Date();
    const expected = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    // Capture baseline from latest snapshot page metrics if available
    const snapRow = await this.prisma.searchDataSnapshot.findFirst({
      where: { workspaceId: params.workspaceId, propertyId: params.propertyId },
      orderBy: { retrievedAt: "desc" },
    });
    let baseline: any = {};
    if (snapRow) {
      const snap = snapRow.normalizedJson as unknown as SearchPerformanceSnapshot;
      baseline = {
        baselineClicks: snap.page.clicks,
        baselineCtr: `${(snap.page.ctr * 100).toFixed(1)}%`,
        baselinePosition: snap.page.position,
        baselineCapturedAt: now,
        // Prompt 3 (Measure): pin the exact snapshot row the baseline came
        // from. Written once on the same idempotent transition (re-apply
        // returns early above), never overwritten by GET/ingest/check.
        baselineSnapshotId: snapRow.id,
      };
    }
    return this.prisma.fix.update({
      where: { id: fix.id },
      data: {
        status: "applied",
        appliedAt: now,
        expectedMeasurementDate: expected,
        ...baseline,
      },
    });
  }

  async dismissFix(params: { workspaceId: string; propertyId: string; fixId: string; reason?: string }): Promise<any> {
    const fix = await this.ensureFixOwned(params.workspaceId, params.propertyId, params.fixId);
    if (fix.status === "dismissed") return fix;
    // Dismiss-after-apply is an intentional cancel path (covered by existing
    // T9 + lifecycle tests): the worker skips non-applied fixes and history
    // records the decision. Do NOT reject it here.
    if (params.reason !== undefined && params.reason !== null) {
      if (typeof params.reason !== "string" || params.reason.length > 500) {
        throw new HttpException(
          { code: "VALIDATION_ERROR", message: "Dismiss reason must be a string of at most 500 characters." },
          HttpStatus.BAD_REQUEST,
        );
      }
    }
    // Prompt 1: record when the dismissal decision happened. Lifecycle
    // behavior is otherwise unchanged (idempotent, terminal state).
    return this.prisma.fix.update({
      where: { id: fix.id },
      data: { status: "dismissed", dismissReason: params.reason, dismissedAt: new Date() },
    });
  }

  async acknowledgeFix(params: { workspaceId: string; propertyId: string; fixId: string }): Promise<void> {
    const fix = await this.ensureFixOwned(params.workspaceId, params.propertyId, params.fixId);
    // Idempotent: already acknowledged → success without further writes.
    if (fix.status === "acknowledged") return;
    // Acknowledge is only meaningful for measured fixes. Without an outcome
    // there is nothing to acknowledge — succeed without changing state.
    const outcome = await this.prisma.fixOutcome.findUnique({ where: { fixId: fix.id } });
    if (!outcome) return;
    // Prompt 1: record when the acknowledgement decision happened.
    await this.prisma.fix.update({ where: { id: fix.id }, data: { status: "acknowledged", acknowledgedAt: new Date() } });
    this.logger.log(`Acknowledged Fix ${fix.id} for property ${params.propertyId}`);
    return;
  }

  // Helpers for measurement
  private parseCtr(ctrStr: string): number {
    if (!ctrStr) return 0;
    const n = Number.parseFloat(ctrStr.replace("%", ""));
    if (Number.isNaN(n)) return 0;
    return n / 100;
  }

  private classifyOutcome(params: {
    before: { clicks: number; ctr: number; position: number };
    after: { clicks: number; ctr: number; position: number };
    snapshotQuality: string;
    snapshotFreshness: string;
    impressions: number;
  }): "positive_change" | "no_material_change" | "negative_change" | "insufficient_data" | "data_delayed" | "conflicting_data" | "unavailable" {
    const { before, after, snapshotQuality, snapshotFreshness, impressions } = params;
    const cfg = measurementConfig;

    // Insufficient / delayed / unavailable checks (respect snapshot meta)
    if (snapshotQuality === "missing" || snapshotQuality === "unavailable" || impressions < cfg.MIN_IMPRESSIONS_FOR_MEASUREMENT) {
      return "insufficient_data";
    }
    if (snapshotFreshness === "delayed" || snapshotFreshness === "stale") {
      return "data_delayed";
    }
    if (snapshotQuality === "unavailable" as string) {
      return "unavailable";
    }

    const clicksPct = before.clicks === 0 ? (after.clicks > 0 ? 1 : 0) : (after.clicks - before.clicks) / before.clicks;
    const ctrDelta = after.ctr - before.ctr;
    const posDelta = after.position - before.position; // negative = improvement

    const clicksUp = clicksPct >= cfg.POSITIVE_CLICKS_PCT;
    const clicksDown = clicksPct <= cfg.NEGATIVE_CLICKS_PCT;
    const posUp = posDelta <= cfg.POSITION_DECLINE; // improvement (more negative than -0.7)
    const posDown = posDelta >= -cfg.POSITION_DECLINE; // decline (positive >0.7)
    // For decline, posDelta positive large means worsened
    const posImproved = posDelta <= -cfg.POSITION_IMPROVEMENT;
    const posWorsened = posDelta >= cfg.POSITION_IMPROVEMENT;
    const ctrUp = ctrDelta >= cfg.CTR_IMPROVEMENT_ABSOLUTE;
    const ctrDown = ctrDelta <= cfg.CTR_DECLINE_ABSOLUTE;

    // Conflicting: clicks and position disagree beyond band
    const conflicting =
      (clicksUp && posWorsened) || (clicksDown && posImproved) || (clicksUp && ctrDown && posWorsened) || (clicksDown && ctrUp && posImproved);
    if (conflicting) {
      // Also check thresholds for conflicting
      const clicksConflict = Math.abs(clicksPct) >= cfg.CONFLICTING_CLICKS_PCT;
      const posConflict = Math.abs(posDelta) >= cfg.CONFLICTING_POSITION_DELTA;
      if (clicksConflict && posConflict) return "conflicting_data";
    }

    if ((clicksUp && (posImproved || ctrUp)) || (posImproved && ctrUp)) {
      return "positive_change";
    }
    if ((clicksDown && (posWorsened || ctrDown)) || (posWorsened && ctrDown)) {
      return "negative_change";
    }
    // Also pure clicks threshold without position/ctr
    if (clicksUp) return "positive_change";
    if (clicksDown) return "negative_change";

    return "no_material_change";
  }

  async checkFix(
    params: { workspaceId: string; propertyId: string; fixId: string },
  ): Promise<{ status: string; message?: string; outcome?: any }> {
    const fix = await this.ensureFixOwned(params.workspaceId, params.propertyId, params.fixId);

    // Must be applied
    if (fix.status !== "applied") {
      return { status: "measurement_pending", message: "Fix not yet applied — apply first." };
    }

    return this.measureAppliedFix(fix);
  }

  /**
   * Shared measurement core (Prompt 4 — single source of truth).
   *
   * Used by BOTH manual `checkFix` and the automatic measurement worker, so
   * window/baseline/selection/classifier/outcome semantics are identical.
   * Takes the loaded Fix row (its own workspaceId/propertyId scope every
   * query — callers never supply scope separately) and implements the exact
   * Prompt 3 rules below. Moved verbatim from `checkFix`; no logic change.
   */
  async measureAppliedFix(fix: any): Promise<{ status: string; message?: string; outcome?: any }> {

    // Check idempotency: if outcome already exists for this fix, return it
    const existingByFix = await this.prisma.fixOutcome.findUnique({ where: { fixId: fix.id } });
    if (existingByFix) {
      return {
        status: existingByFix.status.replace(/_/g, "-"),
        outcome: {
          status: existingByFix.status.replace(/_/g, "-"),
          before: existingByFix.beforeJson,
          after: existingByFix.afterJson,
          measuredAt: existingByFix.measuredAt,
        },
      };
    }

    // Window check
    const now = new Date();
    if (fix.expectedMeasurementDate && now < fix.expectedMeasurementDate) {
      return { status: "measurement_pending", message: "Measurement window not yet reached — check back after the 14-day window." };
    }

    // Baseline must exist
    if (!fix.baselineCapturedAt || fix.baselineClicks === null || fix.baselineCtr === null || fix.baselinePosition === null) {
      return { status: "insufficient_data", message: "Baseline not available for measurement." };
    }

    const before = {
      clicks: fix.baselineClicks!,
      ctr: this.parseCtr(fix.baselineCtr!),
      position: fix.baselinePosition!,
    };

    // Find the after snapshot for same workspace + property (Prompt 3):
    // the EARLIEST snapshot that is genuinely post-change data — retrieved
    // at/after the measurement window end, arrived after the baseline was
    // captured, and never the baseline row itself. Scoping by workspaceId +
    // propertyId keeps cross-property/workspace rows out. The arrival filter
    // matters: a pre-baseline snapshot can otherwise qualify by retrieval
    // date alone (e.g. backdated windows) and invert the comparison.
    const windowEnd = fix.expectedMeasurementDate;
    const capturedAt = fix.baselineCapturedAt as Date | null;
    if (!windowEnd || !capturedAt) {
      // No window was ever established for this row (unreachable via apply,
      // which always sets it): without a window no post-window comparison
      // can be proven — delayed, transient, nothing persisted.
      return {
        status: "data_delayed",
        outcome: {
          status: "data_delayed",
          before: { clicks: before.clicks, ctr: fix.baselineCtr, position: before.position },
          after: null,
          measuredAt: now,
          message: "Search Console data is delayed — measurement not yet reliable.",
        },
      };
    }
    const afterWhere: Record<string, unknown> = {
      workspaceId: fix.workspaceId,
      propertyId: fix.propertyId,
      retrievedAt: { gte: windowEnd },
      // Arrived after the baseline capture (see above).
      createdAt: { gt: capturedAt },
    };
    if (fix.baselineSnapshotId) {
      // Exact pin (Prompt 3): the baseline row can never serve as its own
      // after snapshot, even if its retrievedAt qualifies (fixtures).
      afterWhere.id = { not: fix.baselineSnapshotId };
    }
    // Legacy rows (pre-Prompt-3, pin null) rely on the createdAt arrival
    // filter above: the baseline row existed at capture time, so only
    // strictly later rows can be genuinely new data. Unresolvable rows fail
    // open below (no suppression on unknown evidence).
    const currentSnapRow = await this.prisma.searchDataSnapshot.findFirst({
      where: afterWhere as any,
      orderBy: [{ retrievedAt: "asc" }, { id: "asc" }],
    });

    if (!currentSnapRow) {
      const anySnapshot = await this.prisma.searchDataSnapshot.count({
        where: { workspaceId: fix.workspaceId, propertyId: fix.propertyId },
      });
      if (anySnapshot === 0) {
        const outcome = await this.prisma.fixOutcome.create({
          data: {
            fixId: fix.id,
            status: "unavailable",
            beforeJson: { clicks: before.clicks, ctr: fix.baselineCtr, position: before.position } as any,
            afterJson: null as any,
            measuredAt: now,
          },
        });
        return { status: "unavailable", outcome: { status: "unavailable", before: outcome.beforeJson, after: null, measuredAt: outcome.measuredAt } };
      }
      // Window elapsed but no valid post-window snapshot yet (or the only
      // qualifier is the baseline row itself): DATA_DELAYED, transient — do
      // NOT persist (a persisted outcome would brick later measurement when
      // real post-window data arrives), do NOT self-compare, do NOT classify.
      return {
        status: "data_delayed",
        outcome: {
          status: "data_delayed",
          before: { clicks: before.clicks, ctr: fix.baselineCtr, position: before.position },
          after: null,
          measuredAt: now,
          message: "Search Console data is delayed — measurement not yet reliable.",
        },
      };
    }

    // Explicit self-comparison guard (Part 6): the after row must differ from
    // the pinned baseline row. Unreachable via the query above; kept as a
    // second barrier so a future query edit can never silently self-compare.
    if (fix.baselineSnapshotId && currentSnapRow.id === fix.baselineSnapshotId) {
      return {
        status: "data_delayed",
        outcome: {
          status: "data_delayed",
          before: { clicks: before.clicks, ctr: fix.baselineCtr, position: before.position },
          after: null,
          measuredAt: now,
          message: "Search Console data is delayed — measurement not yet reliable.",
        },
      };
    }

    const currentSnapshot = currentSnapRow.normalizedJson as unknown as SearchPerformanceSnapshot;
    const afterPage = currentSnapshot.page;
    const after = {
      clicks: afterPage.clicks,
      ctr: afterPage.ctr,
      position: afterPage.position,
    };

    // Handle stale/delayed snapshot honestly
    if (currentSnapshot.meta.freshness === "delayed" || currentSnapshot.meta.freshness === "stale") {
      const outcome = await this.prisma.fixOutcome.create({
        data: {
          fixId: fix.id,
          status: "data_delayed",
          beforeJson: { clicks: before.clicks, ctr: fix.baselineCtr, position: before.position } as any,
          afterJson: { clicks: after.clicks, ctr: `${(after.ctr * 100).toFixed(1)}%`, position: after.position } as any,
          measuredAt: now,
        },
      });
      return {
        status: "data_delayed",
        outcome: {
          status: "data_delayed",
          before: outcome.beforeJson,
          after: outcome.afterJson,
          measuredAt: outcome.measuredAt,
          message: "Search Console data is delayed — measurement not yet reliable.",
        },
      };
    }

    // Classify
    const statusUnderscore = this.classifyOutcome({
      before,
      after,
      snapshotQuality: currentSnapshot.meta.quality,
      snapshotFreshness: currentSnapshot.meta.freshness,
      impressions: afterPage.impressions,
    });

    const beforeJson = { clicks: before.clicks, ctr: fix.baselineCtr, position: before.position };
    const afterJson = { clicks: after.clicks, ctr: `${(after.ctr * 100).toFixed(1)}%`, position: after.position };

    let outcome: any;
    try {
      outcome = await this.prisma.fixOutcome.create({
        data: {
          fixId: fix.id,
          status: statusUnderscore as any,
          beforeJson: beforeJson as any,
          afterJson: afterJson as any,
          measuredAt: now,
        },
      });
    } catch (e: unknown) {
      // Handle race: duplicate fixId unique constraint (P2002) → return existing
      if (e && typeof e === "object" && "code" in (e as Record<string, unknown>) && (e as { code: string }).code === "P2002") {
        const existing = await this.prisma.fixOutcome.findUnique({ where: { fixId: fix.id } });
        if (existing) {
          return {
            status: existing.status.replace(/_/g, "-"),
            outcome: {
              status: existing.status.replace(/_/g, "-"),
              before: existing.beforeJson,
              after: existing.afterJson,
              measuredAt: existing.measuredAt,
              message: (existing as any).message ?? "Observed change after fix; does not establish causation.",
            },
          };
        }
      }
      throw e;
    }

    // Non-causal message
    const messageMap: Record<string, string> = {
      positive_change: `Clicks changed from ${before.clicks} to ${after.clicks} during the measurement period. This is an observed change after the fix was applied; it does not establish causation.`,
      negative_change: `Clicks changed from ${before.clicks} to ${after.clicks} during the measurement period. This is an observed change after the fix was applied; it does not establish causation.`,
      no_material_change: `No material change observed from ${before.clicks} to ${after.clicks} clicks during the measurement period. This is an observed change after the fix was applied; it does not establish causation.`,
      insufficient_data: "Not enough data to measure outcome reliably.",
      data_delayed: "Search Console data is delayed — measurement not yet reliable.",
      conflicting_data: "Metrics moved in different directions — observed change is conflicting.",
      unavailable: "Measurement unavailable — no current data.",
    };

    return {
      status: statusUnderscore.replace(/_/g, "-"),
      outcome: {
        status: statusUnderscore.replace(/_/g, "-"),
        before: beforeJson,
        after: afterJson,
        measuredAt: outcome.measuredAt,
        message: messageMap[statusUnderscore] ?? "Observed change after fix; does not establish causation.",
      },
    };
  }

  /**
   * Worker entry (Prompt 4): measure one Fix by id using the shared core.
   *
   * The Fix row is authoritative — workspaceId/propertyId for every query
   * come from the row itself (Part 15: never trust payload scope). Result
   * categories let the queue layer decide retry vs success without
   * reimplementing any measurement rule:
   *   - "measured": an outcome row now exists (created or replayed).
   *   - "deferred-window": pre-window; caller re-enqueues for the window end.
   *   - "deferred-data": window elapsed but no valid after snapshot yet AND
   *     nothing was persisted; caller treats as retryable (bounded attempts).
   *   - "skipped": permanent no-op (missing/ineligible fix); never retried.
   */
  async measureById(
    fixId: string,
  ): Promise<
    | { result: "measured"; status: string; outcome?: any }
    | { result: "deferred-window"; expectedMeasurementDate: Date }
    | { result: "deferred-data"; status: string; outcome?: any }
    | { result: "skipped"; reason: string }
  > {
    const fix = await this.prisma.fix.findUnique({ where: { id: fixId } });
    if (!fix) {
      return { result: "skipped", reason: "fix-not-found" };
    }
    if (fix.status !== "applied") {
      // Dismissed/superseded/reviewed/available/acknowledged: never
      // automatically measured (Part 11). Terminal, no retry.
      return { result: "skipped", reason: `not-applied:${fix.status}` };
    }
    if (!fix.expectedMeasurementDate) {
      // No window was ever established (unreachable via apply): no date
      // logic can make this measurable — permanent no-op, never retried.
      return { result: "skipped", reason: "no-window" };
    }
    const core = await this.measureAppliedFix(fix);
    if (core.status === "measurement_pending") {
      return { result: "deferred-window", expectedMeasurementDate: fix.expectedMeasurementDate as Date };
    }
    // The core persists every terminal result (classified outcomes,
    // stale-content delayed, zero-snapshot unavailable). If no row exists,
    // the result was transient (pre-existing rows untouched) → retryable.
    const recorded = await this.prisma.fixOutcome.findUnique({ where: { fixId: fix.id } });
    if (recorded) {
      return { result: "measured", status: core.status, outcome: core.outcome };
    }
    return { result: "deferred-data", status: core.status, outcome: core.outcome };
  }
}
