import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SEARCH_CONSOLE_PROVIDER, SearchConsoleProvider, GscSiteEntry } from "./search-console.provider";

@Injectable()
export class SearchConsoleService {
  private readonly logger = new Logger(SearchConsoleService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SEARCH_CONSOLE_PROVIDER) private readonly provider: SearchConsoleProvider,
  ) {}

  private toPropertyType(siteUrl: string): "domain" | "url_prefix" {
    return siteUrl.startsWith("sc-domain:") ? "domain" : "url_prefix";
  }

  private toDisplayName(siteUrl: string): string {
    if (siteUrl.startsWith("sc-domain:")) {
      return siteUrl.slice("sc-domain:".length);
    }
    // For url-prefix, use siteUrl as displayName (without trailing slash for nicer display? keep trailing slash for canonical)
    return siteUrl;
  }

  private toSiteOrigin(siteUrl: string): string {
    if (siteUrl.startsWith("sc-domain:")) {
      const domain = siteUrl.slice("sc-domain:".length);
      return `https://${domain}`;
    }
    try {
      const u = new URL(siteUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return siteUrl;
    }
  }

  private toPermissionLevel(level: GscSiteEntry["permissionLevel"]): "siteOwner" | "siteFullUser" | "siteRestrictedUser" | "siteUnverifiedUser" {
    return level;
  }

  private toStatus(level: GscSiteEntry["permissionLevel"]): "healthy" | "needs_attention" | "stale" | "disconnected" {
    switch (level) {
      case "siteOwner":
      case "siteFullUser":
        return "healthy";
      case "siteRestrictedUser":
        return "needs_attention";
      case "siteUnverifiedUser":
        return "disconnected";
      default:
        return "healthy";
    }
  }

  private isSelectable(level: GscSiteEntry["permissionLevel"]): boolean {
    return level === "siteOwner" || level === "siteFullUser";
  }

  async syncProperties(params: { workspaceId: string; userId: string }): Promise<{ synced: number; properties: GscSiteEntry[] }> {
    const result = await this.provider.listProperties({ workspaceId: params.workspaceId, userId: params.userId });
    if (!result.ok) {
      throw result.error;
    }

    const entries = result.data;
    let synced = 0;

    for (const entry of entries) {
      const type = this.toPropertyType(entry.siteUrl);
      const displayName = this.toDisplayName(entry.siteUrl);
      const siteOrigin = this.toSiteOrigin(entry.siteUrl);
      const permissionLevel = this.toPermissionLevel(entry.permissionLevel);
      const status = this.toStatus(entry.permissionLevel);
      const isSelectable = this.isSelectable(entry.permissionLevel);

      await this.prisma.searchProperty.upsert({
        where: { workspaceId_siteUrl: { workspaceId: params.workspaceId, siteUrl: entry.siteUrl } },
        update: {
          displayName,
          type,
          permissionLevel,
          status,
          isSelectable,
          siteOrigin,
        },
        create: {
          workspaceId: params.workspaceId,
          siteUrl: entry.siteUrl,
          displayName,
          type,
          permissionLevel,
          status,
          isSelectable,
          siteOrigin,
        },
      });
      synced++;
    }

    this.logger.log(`Synced ${synced} properties for workspace ${params.workspaceId}`);
    return { synced, properties: entries };
  }

  async listPropertiesFromDb(workspaceId: string) {
    const props = await this.prisma.searchProperty.findMany({
      where: { workspaceId },
      orderBy: { displayName: "asc" },
    });
    // Map to frontend SearchProperty shape (id, name, type). The canonical
    // GSC identifier (`siteUrl`) stays server-side — the frontend only ever
    // handles opaque property ids (same boundary rule as history snapshots).
    return props.map((p) => ({
      id: p.id,
      name: p.displayName,
      type: p.type === "url_prefix" ? "url-prefix" : "domain",
      status: p.status,
      isSelectable: p.isSelectable,
      permissionLevel: p.permissionLevel,
    }));
  }
}
