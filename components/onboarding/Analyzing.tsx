"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { AnalysisScenario, mockAnalysisService, referenceId } from "@/lib/mock/analysis-service";
import { AnalysisStatus } from "@/lib/mock/types";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

const STILL_WORKING_THRESHOLD_MS = 8000;

const statusLine: Partial<Record<AnalysisStatus, string>> = {
  queued: "Preparing your analysis.",
  connecting: "Preparing your analysis.",
  "loading-data": "Reading your Search Console data.",
  analyzing: "Looking for meaningful changes.",
  ranking: "Choosing the one change worth surfacing.",
  complete: "Your next fix is ready.",
};

const checklistSteps: { status: AnalysisStatus; label: string }[] = [
  { status: "loading-data", label: "Reading Search Console data" },
  { status: "analyzing", label: "Comparing pages with their recent baseline" },
  { status: "ranking", label: "Choosing the one change worth surfacing" },
];

const checklistOrder: AnalysisStatus[] = ["queued", "connecting", "loading-data", "analyzing", "ranking", "complete"];

function ChecklistIcon({ state }: { state: "done" | "current" | "pending" }) {
  if (state === "done") {
    return <span className="text-brick">✓</span>;
  }
  if (state === "current") {
    return <span className="text-ink">•</span>;
  }
  return <span className="text-ink-muted">○</span>;
}

const nonTerminalStatuses = new Set<AnalysisStatus>(["queued", "connecting", "loading-data", "analyzing", "ranking"]);

function AnalyzingInner() {
  const session = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scenario = (searchParams.get("scenario") as AnalysisScenario | null) ?? "complete";

  const [status, setStatus] = useState<AnalysisStatus>("queued");
  const [terminal, setTerminal] = useState<AnalysisStatus | null>(null);
  const [stillWorking, setStillWorking] = useState(false);
  const [refId] = useState(referenceId);
  const runIdRef = useRef(0);

  const propertyName = session.onboarding.propertyId ?? "your site";

  const run = useCallback(
    (activeScenario: AnalysisScenario) => {
      const runId = ++runIdRef.current;
      setTerminal(null);
      setStillWorking(false);
      setStatus("queued");

      const stillWorkingTimer = setTimeout(() => {
        if (runIdRef.current === runId) setStillWorking(true);
      }, STILL_WORKING_THRESHOLD_MS);

      mockAnalysisService
        .runAnalysis(activeScenario, (nextStatus) => {
          if (runIdRef.current !== runId) return;
          setStatus(nextStatus);
          session.setAnalysisStatus(nextStatus);
          // Every terminal status (complete/insufficient-data/no-opportunity/
          // failed) is reported through this same callback, so it's always
          // safe to act on it here rather than inferring it later.
          if (!nonTerminalStatuses.has(nextStatus)) setTerminal(nextStatus);
        })
        .then((fix) => {
          if (runIdRef.current !== runId) return;
          clearTimeout(stillWorkingTimer);
          if (fix) session.setFix(fix);
        });

      return () => clearTimeout(stillWorkingTimer);
    },
    [session]
  );

  useEffect(() => {
    const cleanup = run(scenario);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario]);

  const isComplete = terminal === "complete";
  const isFailed = terminal === "failed";
  const isInsufficient = terminal === "insufficient-data";
  const isNoOpportunity = terminal === "no-opportunity";

  return (
    <div className="py-16 md:py-24">
      <Container>
        <div className="mx-auto w-full max-w-[520px]">
          {stillWorking && !terminal ? (
            <>
              <h1 className="font-serif text-h1 text-ink">Still working</h1>
              <p className="mt-3 text-body-lg text-ink-muted">
                RENKO is taking longer than expected to evaluate {propertyName}. You can stay here or come back
                later — your progress is saved.
              </p>
              <Button variant="primary" type="button" className="mt-6" href="/">
                Continue later
              </Button>
            </>
          ) : isFailed ? (
            <>
              <h1 className="font-serif text-h1 text-ink">RENKO couldn&apos;t complete this analysis</h1>
              <p className="mt-3 text-body-lg text-ink-muted">The Search Console data could not be evaluated right now.</p>
              <p className="mt-1 text-caption text-ink-muted">Reference ID: {refId}</p>
              <Button variant="primary" type="button" className="mt-6" onClick={() => run("complete")}>
                Try again
              </Button>
            </>
          ) : isInsufficient ? (
            <>
              <h1 className="font-serif text-h1 text-ink">Not enough data yet</h1>
              <p className="mt-3 text-body-lg text-ink-muted">
                RENKO couldn&apos;t find a reliable next fix from the data available for {propertyName}.
              </p>
              <Alert tone="info" role="status">
                What RENKO needs: more Search Console history and meaningful search activity.
              </Alert>
              <Button variant="secondary" type="button" className="mt-6" onClick={() => run("complete")}>
                Check again later
              </Button>
            </>
          ) : isNoOpportunity ? (
            <>
              <h1 className="font-serif text-h1 text-ink">Nothing worth changing yet</h1>
              <p className="mt-3 text-body-lg text-ink-muted">
                RENKO checked the available Search Console data for {propertyName} and didn&apos;t find a change
                strong enough to recommend. This isn&apos;t an error.
              </p>
              <p className="mt-4 text-caption text-ink-muted">Last analysis: just now · Next check: in 7 days</p>
              <Button variant="secondary" type="button" className="mt-6" onClick={() => run("complete")}>
                Check again now
              </Button>
            </>
          ) : (
            <>
              <h1 className="font-serif text-h1 text-ink">Analyzing {propertyName}</h1>
              <p className="mt-3 text-body-lg text-ink-muted" role="status" aria-live="polite">
                {statusLine[status]}
              </p>

              <ul className="mt-8 flex flex-col gap-3">
                {checklistSteps.map((step) => {
                  const currentIndex = checklistOrder.indexOf(status);
                  const stepIndex = checklistOrder.indexOf(step.status);
                  const state: "done" | "current" | "pending" =
                    currentIndex > stepIndex || isComplete ? "done" : currentIndex === stepIndex ? "current" : "pending";
                  return (
                    <li key={step.status} className="flex items-center gap-3 text-body text-ink">
                      <ChecklistIcon state={state} />
                      {step.label}
                    </li>
                  );
                })}
              </ul>

              {isComplete && (
                <Button
                  variant="primary"
                  type="button"
                  className="mt-8"
                  onClick={() => router.push(resumeRoute(session.onboarding))}
                >
                  See your fix
                </Button>
              )}
            </>
          )}
        </div>
      </Container>
    </div>
  );
}

export function Analyzing() {
  return (
    <Suspense fallback={null}>
      <AnalyzingInner />
    </Suspense>
  );
}
