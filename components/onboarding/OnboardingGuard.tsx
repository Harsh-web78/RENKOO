"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MinimalHeader } from "@/components/layout/MinimalHeader";
import { useSession } from "@/lib/mock/session-context";
import { OnboardingProgress } from "./OnboardingProgress";
import { resumeRoute, stepIdForPath, stepIndex } from "@/lib/mock/onboarding";

/**
 * Auth guard — and, once authenticated, step-order guard — live here,
 * client-side, because the mock session lives in localStorage with no
 * server-side counterpart yet. When a real backend exists both checks
 * move server-side (middleware/cookies); this component then only needs
 * to keep rendering the chrome + progress bar.
 */
export function OnboardingGuard({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const currentStepId = stepIdForPath(pathname);
  const resumePath = session.hydrated ? resumeRoute(session.onboarding) : null;
  const resumeStepId = resumePath ? stepIdForPath(resumePath) : null;
  const isAheadOfProgress = resumeStepId !== null && stepIndex(currentStepId) > stepIndex(resumeStepId);

  useEffect(() => {
    if (!session.hydrated) return;
    if (session.auth.status !== "authenticated") {
      router.replace("/log-in");
      return;
    }
    // Trying to skip ahead of a step that isn't actually done yet —
    // send them back to the furthest step they've legitimately reached.
    // Revisiting an earlier, already-completed step is always allowed.
    if (isAheadOfProgress && resumePath) {
      router.replace(resumePath);
    }
  }, [session.hydrated, session.auth.status, isAheadOfProgress, resumePath, router]);

  if (!session.hydrated || session.auth.status !== "authenticated" || isAheadOfProgress) {
    return (
      <>
        <MinimalHeader />
        <main className="flex-1" />
      </>
    );
  }

  return (
    <>
      <MinimalHeader
        right={
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="min-h-[44px]"
            onClick={() => { session.signOut(); router.push("/"); }}
          >
            Log out
          </Button>
        }
      />
      <OnboardingProgress onboarding={session.onboarding} currentStepId={currentStepId} />
      <main className="flex-1">{children}</main>
    </>
  );
}
