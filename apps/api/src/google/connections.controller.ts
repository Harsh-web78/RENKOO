import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../common/guards/session-auth.guard";
import { WorkspaceAuthGuard } from "../workspaces/guards/workspace.guard";
import { GoogleOAuthService } from "./google-oauth.service";

@Controller("workspaces/:workspaceId/connections")
export class ConnectionsController {
  constructor(private readonly google: GoogleOAuthService) {}

  @Get("status")
  @UseGuards(SessionAuthGuard, WorkspaceAuthGuard)
  async status(@Param("workspaceId") workspaceId: string): Promise<{
    connected: boolean;
    status: string | null;
    googleAccountEmail: string | null;
    scopes: string[];
    connectedAt: string | null;
    accessTokenExpiresAt: string | null;
  }> {
    const conn = await this.google.getConnectionStatus(workspaceId);
    if (!conn) {
      return {
        connected: false,
        status: null,
        googleAccountEmail: null,
        scopes: [],
        connectedAt: null,
        accessTokenExpiresAt: null,
      };
    }
    return {
      connected: conn.status === "connected",
      status: conn.status,
      googleAccountEmail: conn.googleAccountEmail,
      scopes: conn.scopes,
      connectedAt: conn.connectedAt,
      accessTokenExpiresAt: conn.accessTokenExpiresAt,
    };
  }
}
