import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export const HISTORY_DEFAULT_LIMIT = 25;
export const HISTORY_MAX_LIMIT = 100;

interface HistoryListParams {
  workspaceId: string;
  limit?: number;
  offset?: number;
}

interface HistoryDetailParams {
  workspaceId: string;
  fixId: string;
}

function formatCtr(ratio: number): string {
  const value = typeof ratio === "number" && Number.isFinite(ratio) ? ratio : 0;
  return `${(value * 100).toFixed(1)}%`;
}

function dashStatus(status: string): string {
  return status.replace(/_/g, "-");
}

/**
 * Strips internal-only keys from a stored snapshot before it leaves the
 * API. The frontend contract (`SearchProperty`) has no `siteUrl` field —
 * the canonical GSC identifier stays server-side.
 */
function sanitizeSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  const meta = snapshot.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== "object") return snapshot;
  const property = meta.property as Record<string, unknown> | undefined;
  if (!property || typeof property !== "object" || !("siteUrl" in property)) return snapshot;
  const { siteUrl: _dropped, ...restProperty } = property as Record<string, unknown> & { siteUrl?: unknown };
  void _dropped;
  return { ...snapshot, meta: { ...meta, property: restProperty } };
}

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private clampPagination(limit?: number, offset?: number): { limit: number; offset: number } {
    const parsedLimit = Number.isFinite(limit) ? Math.floor(limit as number) : HISTORY_DEFAULT_LIMIT;
    const parsedOffset = Number.isFinite(offset) ? Math.floor(offset as number) : 0;
    return {
      limit: Math.min(Math.max(parsedLimit, 1), HISTORY_MAX_LIMIT),
      offset: Math.max(parsedOffset, 0),
    };
  }

  /**
   * Maps a Fix row (+ its Recommendation + Outcome) to the frontend
   * `HistoryItem` shape. Pure shaping — no business logic, no new facts.
   * Returns null for rows that are not history (current, unmeasured fixes
   * stay on Home/Fixes, never in history).
   */
  private async toHistoryItem(fix: {
    id: string;
    propertyId: string;
    page: string;
    status: string;
    dismissReason: string | null;
    appliedAt: Date | null;
    recommendationId: string | null;
  }): Promise<Record<string, unknown> | null> {
    const outcome = await this.prisma.fixOutcome.findUnique({ where: { fixId: fix.id } });
    const isDismissed = fix.status === "dismissed";
    const isAcknowledged = fix.status === "acknowledged";
    // History = dismissed fixes + measured (applied with outcome) fixes +
    // acknowledged fixes (acknowledge requires an outcome, so these are measured).
    // Available/reviewed/applied-without-outcome are "current", not history.
    if (!isDismissed && !isAcknowledged && !outcome) return null;

    const rec = fix.recommendationId
      ? await this.prisma.recommendation.findUnique({ where: { id: fix.recommendationId } })
      : null;
    if (!rec) return null;

    const snapshot = sanitizeSnapshot((rec.snapshotJson ?? {}) as Record<string, unknown>);
    const snapshotPage = (snapshot.page ?? {}) as Record<string, unknown>;
    const comparisonPage = (snapshot.comparisonPage ?? {}) as Record<string, unknown> | undefined;
    const evidence = (rec.evidenceJson ?? { rows: [] }) as Record<string, unknown>;
    const pageMetrics = {
      clicks: typeof snapshotPage.clicks === "number" ? snapshotPage.clicks : 0,
      impressions: typeof snapshotPage.impressions === "number" ? snapshotPage.impressions : 0,
      ctr: typeof snapshotPage.ctr === "number" ? snapshotPage.ctr : 0,
      position: typeof snapshotPage.position === "number" ? snapshotPage.position : 0,
    };
    const baselineClicks = typeof comparisonPage?.clicks === "number" ? comparisonPage.clicks : pageMetrics.clicks;
    const clicksDeltaPct =
      baselineClicks === 0 ? 0 : Math.round(((pageMetrics.clicks - baselineClicks) / baselineClicks) * 100);

    const mappedOutcome = outcome
      ? {
          status: dashStatus(outcome.status),
          before: outcome.beforeJson,
          ...(outcome.afterJson ? { after: outcome.afterJson } : {}),
          ...(outcome.measuredAt ? { measuredAt: (outcome.measuredAt as Date).toISOString?.() ?? outcome.measuredAt } : {}),
        }
      : undefined;

    const productFix: Record<string, unknown> = {
      id: fix.id,
      page: rec.page,
      clicks: pageMetrics.clicks,
      clicksDeltaPct,
      impressions: pageMetrics.impressions,
      ctr: formatCtr(pageMetrics.ctr),
      position: pageMetrics.position,
      positionBaseline:
        typeof comparisonPage?.position === "number" ? comparisonPage.position : pageMetrics.position,
      finding: rec.finding,
      interpretation: rec.interpretation,
      recommendedChange: rec.recommendedAction,
      why: rec.rationale,
      evidence,
      dataMeta: snapshot.meta,
      status: fix.status,
      measurementWindowDays: 14,
      ...(fix.dismissReason ? { dismissReason: fix.dismissReason } : {}),
      ...(fix.appliedAt ? { appliedAt: (fix.appliedAt as Date).toISOString?.() ?? fix.appliedAt } : {}),
      ...(mappedOutcome ? { outcome: mappedOutcome } : {}),
    };

    const property = await this.prisma.searchProperty.findUnique({ where: { id: fix.propertyId } });

    return {
      id: fix.id,
      propertyId: fix.propertyId,
      propertyName: property?.displayName ?? fix.propertyId,
      fix: productFix,
      page: rec.page,
      recommendedChange: rec.recommendedAction,
      status: isDismissed ? "dismissed" : "measured",
      appliedAt: fix.appliedAt ? ((fix.appliedAt as Date).toISOString?.() ?? fix.appliedAt) : null,
      ...(fix.dismissReason ? { dismissReason: fix.dismissReason } : {}),
      ...(mappedOutcome ? { outcome: mappedOutcome } : {}),
    };
  }

  async listHistory(params: HistoryListParams): Promise<{ items: unknown[]; total: number; limit: number; offset: number }> {
    const { limit, offset } = this.clampPagination(params.limit, params.offset);
    // History = dismissed fixes + measured (applied with outcome) fixes +
    // acknowledged fixes. Available/reviewed/applied-without-outcome are
    // "current", not history — the relation filter keeps `total` exact
    // instead of filtering after the count.
    const where = {
      workspaceId: params.workspaceId,
      OR: [
        { status: "dismissed" as const },
        { status: "applied" as const, outcome: { isNot: null } },
        { status: "acknowledged" as const },
      ],
    };
    // Deterministic ordering: newest first, id tiebreak (cuid is time-ordered,
    // the explicit secondary key keeps concurrent inserts stable).
    const [rows, total] = await Promise.all([
      this.prisma.fix.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        skip: offset,
      }),
      this.prisma.fix.count({ where }),
    ]);
    const items: unknown[] = [];
    for (const row of rows) {
      const item = await this.toHistoryItem(row);
      if (item) items.push(item);
    }
    return { items, total, limit, offset };
  }

  async getHistoryDetail(params: HistoryDetailParams): Promise<Record<string, unknown> | null> {
    // Workspace-scoped lookup: another workspace's Fix is a 404, never a leak.
    const fix = await this.prisma.fix.findFirst({
      where: { id: params.fixId, workspaceId: params.workspaceId },
    });
    if (!fix) return null;
    return this.toHistoryItem(fix);
  }
}
