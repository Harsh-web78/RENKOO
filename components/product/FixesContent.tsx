"use client";

import { Container } from "@/components/ui/Container";
import { EmptyFixState } from "./EmptyFixState";
import { FixWorkspace } from "./FixWorkspace";
import { RealErrorPanel, RealLoadingSkeleton } from "./RealState";
import { resolveHomeView } from "@/lib/data-contract/real-state";
import { useSession } from "@/lib/mock/session-context";

export function FixesContent() {
  const session = useSession();

  if (session.providerMode === "real") {
    return <RealFixesContent />;
  }

  const propertyId = session.onboarding.propertyId;
  if (!propertyId) return null;

  const state = session.getPropertyState(propertyId);

  return (
    <div className="py-10 md:py-16">
      <Container width="page">
        {state.currentFix ? (
          <FixWorkspace propertyId={propertyId} fix={state.currentFix} />
        ) : (
          <div className="mx-auto w-full max-w-content">
            <h1 className="font-serif text-h1 text-ink">Current fix</h1>
            <div className="mt-6">
              <EmptyFixState
                reason={state.noFixReason}
                lastCheckedAt={state.lastCheckedAt}
                nextCheckAt={state.nextCheckAt}
                lastSuccessfulDataAt={state.lastSuccessfulDataAt}
                onRefresh={() => session.refreshProperty(propertyId)}
                onCheckAgain={() => session.refreshProperty(propertyId)}
                onTryAgain={() => session.refreshProperty(propertyId)}
              />
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}

/** Real-mode Fixes: current Fix lifecycle wired to the backend API. */
function RealFixesContent() {
  const session = useSession();
  const propertyId = session.onboarding.propertyId;

  const view = resolveHomeView({
    sessionLoaded: session.realSessionLoaded,
    sessionError: session.realSessionError,
    propertyId,
    propertyStatus: propertyId ? (session.realPropertyStatus[propertyId] ?? "loading") : null,
    propertyError: propertyId ? (session.realPropertyError[propertyId] ?? null) : null,
    state: propertyId ? session.getPropertyState(propertyId) : null,
  });

  return (
    <div className="py-10 md:py-16">
      <Container width="page">
        {(view.kind === "session-loading" || view.kind === "property-loading") && (
          <div className="mx-auto w-full max-w-content">
            <h1 className="font-serif text-h1 text-ink">Current fix</h1>
            <div className="mt-6">
              <RealLoadingSkeleton label="Loading the current fix…" />
            </div>
          </div>
        )}
        {view.kind === "session-error" && view.error && (
          <div className="mx-auto w-full max-w-content">
            <RealErrorPanel error={view.error} onRetry={() => window.location.reload()} retryLabel="Reload" />
          </div>
        )}
        {view.kind === "no-property" && (
          <div className="mx-auto w-full max-w-content">
            <h1 className="font-serif text-h1 text-ink">Current fix</h1>
            <div className="mt-6 rounded-sm border border-line p-6">
              <h2 className="text-h2 font-semibold text-ink">No property selected</h2>
              <p className="mt-2 text-body text-ink-muted">
                RENKO couldn&apos;t find an authorized Search Console property in this workspace yet.
              </p>
            </div>
          </div>
        )}
        {view.kind === "property-error" && view.error && propertyId && (
          <div className="mx-auto w-full max-w-content">
            <h1 className="font-serif text-h1 text-ink">Current fix</h1>
            <div className="mt-6">
              <RealErrorPanel error={view.error} onRetry={() => session.reloadRealProperty(propertyId)} />
            </div>
          </div>
        )}
        {view.kind === "fix" && view.state?.currentFix && propertyId && (
          <FixWorkspace propertyId={propertyId} fix={view.state.currentFix} />
        )}
        {view.kind === "empty" && view.state && propertyId && (
          <div className="mx-auto w-full max-w-content">
            <h1 className="font-serif text-h1 text-ink">Current fix</h1>
            <div className="mt-6">
              <EmptyFixState
                reason={view.state.noFixReason}
                lastCheckedAt={view.state.lastCheckedAt}
                nextCheckAt={view.state.nextCheckAt}
                lastSuccessfulDataAt={view.state.lastSuccessfulDataAt}
                onRefresh={() => session.refreshProperty(propertyId)}
                onCheckAgain={() => session.refreshProperty(propertyId)}
                onTryAgain={() => session.refreshProperty(propertyId)}
              />
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}
