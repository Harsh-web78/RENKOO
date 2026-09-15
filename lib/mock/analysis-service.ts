import { AnalysisStatus, FixRecommendation } from "./types";

/**
 * MOCK ANALYSIS SERVICE — development only.
 *
 * Simulates the step-by-step progression a real analysis job would report
 * over a polling/websocket connection. `runAnalysis` calls `onStatusChange`
 * for each real transition — nothing here is a decorative percentage.
 */

export type AnalysisScenario =
  | "complete"
  | "insufficient-data"
  | "no-opportunity"
  | "timeout"
  | "failed";

const STEP_DELAY_MS = 1100;

const progressSteps: AnalysisStatus[] = ["queued", "connecting", "loading-data", "analyzing", "ranking"];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministic demo fix — clearly not real customer data, used only in the mock analysis result. */
export const mockFixRecommendation: FixRecommendation = {
  page: "/pricing",
  clicks: 74,
  clicksDeltaPct: -34,
  impressions: 2840,
  ctr: "2.6%",
  position: 4.2,
  positionBaseline: 1.8,
  finding: "This page is receiving strong impressions but fewer clicks than expected for its current position.",
  recommendedChange: "Rewrite the page title to match the search intent more directly.",
  why: "The page receives meaningful impressions for its main query, but its click-through rate is weaker than expected at this position.",
  evidence: {
    windowLabel: "Last 28 days vs. prior 28 days",
    rows: [
      { query: "pricing plans", clicks: 31, impressions: 1180, ctr: "2.6%", position: "4.1" },
      { query: "renko pricing", clicks: 18, impressions: 640, ctr: "2.8%", position: "3.9" },
      { query: "seo tool cost", clicks: 12, impressions: 520, ctr: "2.3%", position: "4.6" },
    ],
  },
};

export function referenceId(): string {
  return `RK-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const mockAnalysisService = {
  /**
   * Steps through the real progression states, then resolves into one of
   * the terminal states. `timeout` never resolves within a normal budget —
   * the caller is expected to show the "still working" state after its own
   * elapsed-time threshold, matching how a real long-running job behaves.
   */
  async runAnalysis(
    scenario: AnalysisScenario,
    onStatusChange: (status: AnalysisStatus) => void
  ): Promise<FixRecommendation | null> {
    for (const step of progressSteps) {
      onStatusChange(step);
      await delay(STEP_DELAY_MS);
      if (scenario === "timeout") {
        // Stall indefinitely partway through — the UI's own timer decides
        // when to show "still working," not this service.
        if (step === "analyzing") return new Promise(() => {});
      }
    }

    if (scenario === "failed") {
      onStatusChange("failed");
      return null;
    }
    if (scenario === "insufficient-data") {
      onStatusChange("insufficient-data");
      return null;
    }
    if (scenario === "no-opportunity") {
      onStatusChange("no-opportunity");
      return null;
    }

    onStatusChange("complete");
    return mockFixRecommendation;
  },
};
