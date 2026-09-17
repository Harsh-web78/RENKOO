"use client";

import { Container } from "@/components/ui/Container";
import { CurrentFixSummary } from "./CurrentFixSummary";
import { EmptyFixState } from "./EmptyFixState";
import { RealErrorPanel, RealLoadingSkeleton, SessionFooter } from "./RealState";
import { resolveHomeView } from "@/lib/data-contract/real-state";
import { formatDate } from "@/lib/mock/product-service";
import { useSession } from "@/lib/mock/session-context";

export function HomeContent() {
  const session = useSession();

  if (session.providerMode === "real") {
    return <RealHomeContent />;
  }

  const propertyId = session.onboarding.propertyId;
  if (!propertyId) return null;

  const state = session.getPropertyState(propertyId);

  return (
    <div className="py-10 md:py-16">
      <Container>
        <h1 className="font-serif text-h1 text-ink">Home</h1>

        <div className="mt-6">
          {state.currentFix ? (
            <CurrentFixSummary fix={state.currentFix} />
          ) : (
            <EmptyFixState
              reason={state.noFixReason}
              lastCheckedAt={state.lastCheckedAt}
              nextCheckAt={state.nextCheckAt}
              lastSuccessfulDataAt={state.lastSuccessfulDataAt}
              onRefresh={() => session.refreshProperty(propertyId)}
              onCheckAgain={() => session.refreshProperty(propertyId)}
              onTryAgain={() => session.refreshProperty(propertyId)}
            />
          )}
        </div>

        <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 text-caption text-ink-muted">
          <span>Property: {propertyId}</span>
          <span>Last checked: {formatDate(state.lastCheckedAt)}</span>
          <span>Data through: {formatDate(state.lastSuccessfulDataAt)}</span>
        </div>
      </Container>
    </div>
  );
}

/**
 * Real-mode Home: the backend's ONE recommendation (or its honest empty
 * state). Never mock data, never a blank screen, never a fabricated fix.
 */
function RealHomeContent() {
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
      <Container>
        <h1 className="font-serif text-h1 text-ink">Home</h1>

        <div className="mt-6">
          {view.kind === "session-loading" && <RealLoadingSkeleton label="Signing you in…" />}
          {view.kind === "session-error" && view.error && (
            <RealErrorPanel error={view.error} onRetry={() => window.location.reload()} retryLabel="Reload" />
          )}
          {view.kind === "no-property" && (
            <div className="rounded-sm border border-line p-6">
              <h2 className="text-h2 font-semibold text-ink">No property selected</h2>
              <p className="mt-2 text-body text-ink-muted">
                RENKO couldn&apos;t find an authorized Search Console property in this workspace yet.
              </p>
            </div>
          )}
          {view.kind === "property-loading" && <RealLoadingSkeleton label="Loading your next best fix…" />}
          {view.kind === "property-error" && view.error && propertyId && (
            <RealErrorPanel error={view.error} onRetry={() => session.reloadRealProperty(propertyId)} />
          )}
          {view.kind === "fix" && view.state?.currentFix && <CurrentFixSummary fix={view.state.currentFix} />}
          {view.kind === "empty" && view.state && propertyId && (
            <EmptyFixState
              reason={view.state.noFixReason}
              lastCheckedAt={view.state.lastCheckedAt}
              nextCheckAt={view.state.nextCheckAt}
              lastSuccessfulDataAt={view.state.lastSuccessfulDataAt}
              onRefresh={() => session.refreshProperty(propertyId)}
              onCheckAgain={() => session.refreshProperty(propertyId)}
              onTryAgain={() => session.refreshProperty(propertyId)}
            />
          )}
        </div>

        {propertyId && view.state && (view.kind === "fix" || view.kind === "empty") && (
          <SessionFooter
            propertyId={propertyId}
            lastCheckedAt={view.state.lastCheckedAt}
            lastSuccessfulDataAt={view.state.lastSuccessfulDataAt}
          />
        )}
      </Container>
    </div>
  );
}
