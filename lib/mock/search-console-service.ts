import { GoogleConnectionStatus, SearchConsoleProperty } from "./types";

/**
 * MOCK SEARCH CONSOLE SERVICE — development only.
 *
 * Simulates the OAuth redirect-and-return round trip and property listing.
 * A real implementation replaces `connect()` with an actual redirect to
 * Google and `listProperties()` with a real Search Console API call — the
 * calling screens only depend on the exported types, not on this file.
 *
 * `scenario` lets every outcome be previewed deterministically, the same
 * way a real OAuth callback would arrive with a `?error=` query param —
 * visit /onboarding/connect-search-console?scenario=denied (etc.) to
 * preview a specific outcome. No scenario = the default success path.
 */

export type ConnectScenario =
  | "success"
  | "denied"
  | "insufficient"
  | "mismatch"
  | "expired"
  | "network"
  | "server";

const scenarioToStatus: Record<ConnectScenario, GoogleConnectionStatus> = {
  success: "connected",
  denied: "permission-denied",
  insufficient: "permission-insufficient",
  mismatch: "account-mismatch",
  expired: "expired",
  network: "network-failure",
  server: "server-failure",
};

function delay<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export const mockSearchConsoleService = {
  /** Simulates the full redirect-out, then return-with-result round trip. */
  async connect(scenario: ConnectScenario = "success"): Promise<{ status: GoogleConnectionStatus }> {
    await delay(null, 900); // "redirecting to Google"
    return delay({ status: scenarioToStatus[scenario] }, 700); // "returning from Google"
  },

  async listProperties(
    scenario: "success" | "empty" | "error" = "success"
  ): Promise<SearchConsoleProperty[]> {
    if (scenario === "error") {
      throw new Error("properties-failed-to-load");
    }
    if (scenario === "empty") {
      return delay([], 500);
    }

    const properties: SearchConsoleProperty[] = [
      { id: "example.com", name: "example.com", type: "domain", status: "healthy", selectable: true },
      {
        id: "www.example.com",
        name: "www.example.com",
        type: "url-prefix",
        status: "healthy",
        selectable: true,
      },
      { id: "clientsite.com", name: "clientsite.com", type: "domain", status: "needs-attention", selectable: true },
      { id: "staleclient.com", name: "staleclient.com", type: "domain", status: "stale", selectable: true },
      {
        id: "oldproject.com",
        name: "oldproject.com",
        type: "domain",
        status: "disconnected",
        selectable: false,
      },
    ];
    return delay(properties, 500);
  },
};
