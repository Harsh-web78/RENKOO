import { OnboardingState } from "./types";

export const emptyOnboardingState: OnboardingState = {
  workspaceName: null,
  connection: { status: "not-connected" },
  propertyId: null,
  analysisStatus: null,
  fix: null,
};

export type OnboardingStepId = "workspace" | "search-console" | "website" | "analysis" | "first-fix";

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  href: string;
}

export const onboardingSteps: OnboardingStep[] = [
  { id: "workspace", label: "Workspace", href: "/onboarding/create-workspace" },
  { id: "search-console", label: "Search Console", href: "/onboarding/connect-search-console" },
  { id: "website", label: "Website", href: "/onboarding/select-property" },
  { id: "analysis", label: "Analysis", href: "/onboarding/analyzing" },
  { id: "first-fix", label: "First fix", href: "/onboarding/first-fix" },
];

/** Whether each step is genuinely done — never a fake percentage. */
export function completedSteps(state: OnboardingState): Record<OnboardingStepId, boolean> {
  return {
    workspace: Boolean(state.workspaceName),
    "search-console": state.connection.status === "connected",
    website: Boolean(state.propertyId),
    analysis: state.analysisStatus === "complete" || state.analysisStatus === "insufficient-data" || state.analysisStatus === "no-opportunity",
    "first-fix": Boolean(state.fix),
  };
}

export function stepIdForPath(pathname: string): OnboardingStepId {
  if (pathname.includes("create-workspace")) return "workspace";
  if (pathname.includes("connect-search-console")) return "search-console";
  if (pathname.includes("select-property")) return "website";
  if (pathname.includes("analyzing")) return "analysis";
  return "first-fix";
}

export function stepIndex(id: OnboardingStepId): number {
  return onboardingSteps.findIndex((step) => step.id === id);
}

/**
 * The single source of truth for "where should this person land right
 * now." Used after login and after every onboarding step's primary
 * action, so nobody is ever sent back through a step they've already
 * completed.
 */
export function resumeRoute(state: OnboardingState): string {
  if (!state.workspaceName) return "/onboarding/create-workspace";
  if (state.connection.status !== "connected") return "/onboarding/connect-search-console";
  if (!state.propertyId) return "/onboarding/select-property";
  if (state.analysisStatus === "complete" && state.fix) return "/onboarding/first-fix";
  return "/onboarding/analyzing";
}
