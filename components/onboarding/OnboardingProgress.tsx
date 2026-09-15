"use client";

import { OnboardingState } from "@/lib/mock/types";
import { completedSteps, onboardingSteps } from "@/lib/mock/onboarding";

function StepIcon({ state }: { state: "done" | "current" | "upcoming" }) {
  if (state === "done") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 text-brick">
        <circle cx="8" cy="8" r="7" fill="currentColor" />
        <path d="M4.5 8l2.2 2.2L11.5 5.5" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (state === "current") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 text-brick">
        <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <circle cx="8" cy="8" r="3" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 text-line-strong">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

export function OnboardingProgress({ onboarding, currentStepId }: { onboarding: OnboardingState; currentStepId: string }) {
  const done = completedSteps(onboarding);

  return (
    <nav aria-label="Onboarding progress" className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-page items-center gap-6 overflow-x-auto px-6 py-4 md:px-8">
        {onboardingSteps.map((step) => {
          const state: "done" | "current" | "upcoming" = done[step.id]
            ? "done"
            : step.id === currentStepId
              ? "current"
              : "upcoming";
          return (
            <div key={step.id} className="flex shrink-0 items-center gap-2">
              <StepIcon state={state} />
              <span
                className={`text-caption ${
                  state === "upcoming" ? "text-ink-muted" : "font-medium text-ink"
                }`}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
