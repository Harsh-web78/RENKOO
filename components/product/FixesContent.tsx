"use client";

import { Container } from "@/components/ui/Container";
import { EmptyFixState } from "./EmptyFixState";
import { FixWorkspace } from "./FixWorkspace";
import { useSession } from "@/lib/mock/session-context";

export function FixesContent() {
  const session = useSession();
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
