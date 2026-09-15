"use client";

import { Container } from "@/components/ui/Container";
import { CurrentFixSummary } from "./CurrentFixSummary";
import { EmptyFixState } from "./EmptyFixState";
import { formatDate } from "@/lib/mock/product-service";
import { useSession } from "@/lib/mock/session-context";

export function HomeContent() {
  const session = useSession();
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
