import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SearchConsoleProvider, GscQueryParams } from "../search-console/search-console.provider";
import { SEARCH_CONSOLE_PROVIDER } from "../search-console/search-console.provider";
import { Inject } from "@nestjs/common";
import { normalizeSearchAnalytics } from "./search-data.normalizer";
import { makeTrailingPtPeriod, makePriorPtPeriod, isOutsideSixteenMonths, nowIso, toPtDateString } from "./date-util";
import * as crypto from "crypto";

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly ROW_LIMIT = 25000;
  private readonly SAFE_MAX_PAGES = 4; // 100k rows max per spec §8

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEARCH_CONSOLE_PROVIDER) private readonly provider: SearchConsoleProvider,
  ) {}

  private async fetchAllRows(params: GscQueryParams): Promise<{ rows: any[]; totalFetched: number; truncated: boolean }> {
    let startRow = 0;
    const allRows: any[] = [];
    let truncated = false;
    let pages = 0;

    while (pages < this.SAFE_MAX_PAGES) {
      const res = await this.provider.queryAnalytics({ ...params, rowLimit: this.ROW_LIMIT, startRow });
      if (!res.ok) {
        // Propagate error: check if transient (RATE_LIMITED, UPSTREAM_ERROR) vs permanent (AUTH, PERMISSION, PROPERTY_NOT_FOUND)
        // For permanent, don't retry — throw directly
        if (["AUTH_REQUIRED", "PERMISSION_DENIED", "PROPERTY_NOT_FOUND"].includes(res.error.code)) {
          throw res.error;
        }
        // For transient, provider already retried 3x, so throw
        throw res.error;
      }

      const rows = res.data.rows ?? [];
      allRows.push(...rows);
      pages++;

      if (rows.length < this.ROW_LIMIT) {
        break; // No more pages
      }
      if (rows.length === this.ROW_LIMIT) {
        truncated = true; // Hit limit, might be more
        startRow += this.ROW_LIMIT;
        // Continue to next page unless we hit safe max
        if (pages >= this.SAFE_MAX_PAGES) {
          truncated = true;
          break;
        }
        continue;
      }
      break;
    }

    return { rows: allRows, totalFetched: allRows.length, truncated };
  }

  async ingest(params: { workspaceId: string; propertyId: string; userId: string }): Promise<any> {
    const { workspaceId, propertyId, userId } = params;

    // Validate property belongs to workspace and is selectable
    const property = await this.prisma.searchProperty.findFirst({ where: { id: propertyId, workspaceId } });
    if (!property) {
      throw { code: "PROPERTY_NOT_FOUND", message: "We couldn't find that property in this workspace." } as const;
    }
    // Optionally check selectable: if not selectable, we could still ingest but mark quality issue?
    // For Prompt 10, allow ingestion even if not selectable, but log
    if (!property.isSelectable) {
      this.logger.warn(`Ingesting for non-selectable property ${propertyId} workspace ${workspaceId}`);
    }

    // Determine periods (PT)
    const now = new Date();
    const currentPt = makeTrailingPtPeriod(28, now);
    const priorPt = makePriorPtPeriod(currentPt, 28);

    // 16-month check on current start (prior start will be even earlier, but if current is outside, prior is too)
    if (isOutsideSixteenMonths(currentPt.startIso, now)) {
      throw { code: "UNKNOWN_ERROR", message: "Date range outside 16-month historical limit" } as const;
    }

    const retrievedAt = nowIso();
    const dataThrough = currentPt.endIso; // final data through period end

    // Build SearchProperty for meta
    const searchProperty = {
      id: property.id,
      name: property.displayName,
      type: property.type === "url_prefix" ? ("url-prefix" as const) : ("domain" as const),
      siteUrl: property.siteUrl,
    };

    const period = {
      start: currentPt.startIso,
      end: currentPt.endIso,
      label: currentPt.label,
    };

    // Fetch current and prior rows with pagination
    const currentFetch = await this.fetchAllRows({
      workspaceId,
      siteUrl: property.siteUrl,
      startDate: currentPt.startPt,
      endDate: currentPt.endPt,
      dimensions: ["page", "query"],
      rowLimit: this.ROW_LIMIT,
      startRow: 0,
      dataState: "final",
      type: "web",
      aggregationType: "auto",
    });

    const priorFetch = await this.fetchAllRows({
      workspaceId,
      siteUrl: property.siteUrl,
      startDate: priorPt.startPt,
      endDate: priorPt.endPt,
      dimensions: ["page", "query"],
      rowLimit: this.ROW_LIMIT,
      startRow: 0,
      dataState: "final",
      type: "web",
      aggregationType: "auto",
    });

    // Normalize
    const normalized = normalizeSearchAnalytics({
      siteUrl: property.siteUrl,
      property: searchProperty,
      period,
      priorPeriod: { start: priorPt.startIso, end: priorPt.endIso, label: priorPt.label },
      currentResponse: { rows: currentFetch.rows },
      priorResponse: { rows: priorFetch.rows },
      dimensions: ["page", "query"],
      retrievedAt,
      dataThrough,
      rowLimit: this.ROW_LIMIT,
      totalFetchedRows: currentFetch.totalFetched,
    });

    const snapshot = normalized.snapshot;
    const rawHash = normalized.rawHash;
    const rowCount = currentFetch.totalFetched;

    // Limitations already in snapshot.meta.limitations, but ensure truncated flag adds limitation if not present
    if (normalized.truncated && !snapshot.meta.limitations.some((l) => l.includes("25,000"))) {
      snapshot.meta.limitations.unshift("Only the top 25,000 queries were returned — the full tail is truncated.");
    }

    // Idempotency: check if same hash already exists for this property+period
    const existing = await this.prisma.searchDataSnapshot.findFirst({
      where: { propertyId, periodStart: new Date(period.start), periodEnd: new Date(period.end), rawResponseHash: rawHash },
    });
    if (existing) {
      this.logger.log(`Idempotent ingestion: snapshot already exists ${existing.id} for property ${propertyId}`);
      return existing;
    }

    // Upsert snapshot: use unique [propertyId, periodStart, periodEnd, rawResponseHash] — but we want to create new if hash differs
    // Use create
    const created = await this.prisma.searchDataSnapshot.create({
      data: {
        workspaceId,
        propertyId,
        siteUrl: property.siteUrl,
        periodStart: new Date(period.start),
        periodEnd: new Date(period.end),
        periodLabel: period.label,
        dataThrough: new Date(dataThrough),
        retrievedAt: new Date(retrievedAt),
        freshness: snapshot.meta.freshness,
        quality: snapshot.meta.quality,
        limitations: snapshot.meta.limitations,
        normalizedJson: snapshot as unknown as any,
        rawResponseHash: rawHash,
        rowCount,
      },
    });

    this.logger.log(`Ingested snapshot ${created.id} for property ${propertyId} workspace ${workspaceId} quality ${snapshot.meta.quality} freshness ${snapshot.meta.freshness}`);
    return created;
  }

  async getSnapshot(params: { workspaceId: string; propertyId: string }): Promise<any | null> {
    const { workspaceId, propertyId } = params;
    // Validate property belongs to workspace
    const property = await this.prisma.searchProperty.findFirst({ where: { id: propertyId, workspaceId } });
    if (!property) {
      throw { code: "PROPERTY_NOT_FOUND", message: "We couldn't find that property in this workspace." } as const;
    }

    const latest = await this.prisma.searchDataSnapshot.findFirst({
      where: { workspaceId, propertyId },
      orderBy: { retrievedAt: "desc" },
    });

    return latest;
  }

  // For testing: allow direct normalization without DB
  getNormalizer() {
    return normalizeSearchAnalytics;
  }
}
