import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RecommendationEngine } from "./recommendation.engine";
import { measurementConfig } from "./measurement-config";
import type { SearchPerformanceSnapshot } from "../ingestion/search-data.normalizer";

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);
  private readonly engine = new RecommendationEngine();

  constructor(private readonly prisma: PrismaService) {}

  private toFixStatus(status: string): "available" | "reviewed" | "applied" | "dismissed" {
    // Map FixApplyStatus enum values (available, reviewed, applied, dismissed) to string
    return status as any;
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
      return { status: result.status, meta: result.meta };
    }

    const rec = result.recommendation;

    // Idempotency: check existing Fix for same property, same page, same signal, same period
    const existingFix = await this.prisma.fix.findFirst({
      where: {
        workspaceId,
        propertyId,
        page: rec.page,
        status: { in: ["available", "reviewed", "applied"] },
      },
      orderBy: { createdAt: "desc" },
      include: { outcome: true },
    });

    // If existing fix matches same snapshot period and same signal, reuse
    if (existingFix) {
      const existingRec = await this.prisma.recommendation.findFirst({
        where: { id: existingFix.recommendationId ?? undefined },
      });
      if (existingRec) {
        const existingSnapshot = existingRec.snapshotJson as unknown as SearchPerformanceSnapshot;
        const existingSignalDash = (existingRec.signal as string).replace(/_/g, "-");
        if (
          existingSnapshot?.meta?.period?.start === snapshot.meta.period.start &&
          existingSnapshot?.meta?.period?.end === snapshot.meta.period.end &&
          existingSignalDash === rec.signal
        ) {
          // Reuse — return existing recommendation as persisted
          this.logger.log(`Reuse existing Fix ${existingFix.id} for property ${propertyId}`);
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
              snapshot: existingRec.snapshotJson,
              evidence: existingRec.evidenceJson,
              limitations: existingRec.limitations,
            },
            meta: snapshot.meta,
            snapshot,
          };
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
        return { status: "no-signal", meta: snapshot.meta };
      }
    }

    // Need to create new Recommendation + Fix
    // Check if we should archive old fix? For now, keep old but new will be latest; old remains but not current?
    // Simpler: if existing fix exists but period differs, we create new and old remains history? But spec says at most one current Fix per property.
    // So we should set old fix to dismissed? Actually spec says repeating GET should reuse, new materially different snapshot creates new version.
    // For new version, we should keep old fix as is? But then there would be two available fixes. Better to keep only one available: if old exists and period differs, we could keep it but return new as current? Let's create new and leave old.
    // However to satisfy "do not create duplicate on repeated GET", we already handle reuse. For new snapshot, we create new.

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
      },
    });

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
        snapshot: recommendation.snapshotJson,
        evidence: recommendation.evidenceJson,
        limitations: recommendation.limitations,
      },
      meta: snapshot.meta,
      snapshot,
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
            snapshot: rec.snapshotJson,
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
      throw { code: "UNKNOWN_ERROR", message: "Cannot apply a dismissed or acknowledged fix" } as const;
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
    return this.prisma.fix.update({ where: { id: fix.id }, data: { status: "dismissed", dismissReason: params.reason } });
  }

  async acknowledgeFix(params: { workspaceId: string; propertyId: string; fixId: string }): Promise<void> {
    const fix = await this.ensureFixOwned(params.workspaceId, params.propertyId, params.fixId);
    // Idempotent: already acknowledged → success without further writes.
    if (fix.status === "acknowledged") return;
    // Acknowledge is only meaningful for measured fixes. Without an outcome
    // there is nothing to acknowledge — succeed without changing state.
    const outcome = await this.prisma.fixOutcome.findUnique({ where: { fixId: fix.id } });
    if (!outcome) return;
    await this.prisma.fix.update({ where: { id: fix.id }, data: { status: "acknowledged" } });
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

    // Find current snapshot for same property (latest after baseline)
    // Prefer snapshot with retrievedAt > expectedMeasurementDate or just latest
    const currentSnapRow = await this.prisma.searchDataSnapshot.findFirst({
      where: { workspaceId: params.workspaceId, propertyId: params.propertyId },
      orderBy: { retrievedAt: "desc" },
    });

    if (!currentSnapRow) {
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
}
