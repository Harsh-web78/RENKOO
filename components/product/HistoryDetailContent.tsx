"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { OutcomeCard } from "./OutcomeCard";
import { WhyThisFix } from "./WhyThisFix";
import { formatDate } from "@/lib/mock/product-service";
import { useSession } from "@/lib/mock/session-context";

export function HistoryDetailContent({ fixId }: { fixId: string }) {
  const session = useSession();
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const propertyId = fixId.split("::")[0];
  const state = propertyId ? session.getPropertyState(propertyId) : null;
  const item = state?.history.find((h) => h.id === fixId);

  if (!item) {
    return (
      <div className="py-10 md:py-16">
        <Container>
          <h1 className="font-serif text-h1 text-ink">Not found</h1>
          <p className="mt-3 text-body text-ink-muted">This history item doesn&apos;t exist for the current workspace.</p>
          <Button variant="primary" type="button" href="/history" className="mt-4">
            Back to History
          </Button>
        </Container>
      </div>
    );
  }

  const fix = item.fix;

  return (
    <div className="py-10 md:py-16">
      <Container>
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-serif text-h1 text-ink">{item.recommendedChange}</h1>
          <Badge tone={item.status === "measured" ? "brick" : item.status === "waiting" ? "amber" : "neutral"}>
            {item.status === "measured" ? "Measured" : item.status === "waiting" ? "Waiting for results" : "Dismissed"}
          </Badge>
        </div>
        <p className="mt-2 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-caption text-ink-muted">{item.page}</p>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-4 text-body sm:grid-cols-4">
          <div>
            <dt className="text-caption text-ink-muted">Applied</dt>
            <dd className="mt-0.5 text-ink">{item.appliedAt ? formatDate(item.appliedAt) : "Not applied"}</dd>
          </div>
          {fix.baseline && (
            <div>
              <dt className="text-caption text-ink-muted">Baseline</dt>
              <dd className="mt-0.5 text-ink">
                {fix.baseline.clicks} clicks · {fix.baseline.ctr}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-caption text-ink-muted">Measurement window</dt>
            <dd className="mt-0.5 text-ink">{fix.measurementWindowDays} days</dd>
          </div>
          {item.dismissReason && (
            <div>
              <dt className="text-caption text-ink-muted">Dismiss reason</dt>
              <dd className="mt-0.5 text-ink">{item.dismissReason.replace(/-/g, " ")}</dd>
            </div>
          )}
        </dl>

        <div className="mt-6">
          <h2 className="text-h2 font-semibold text-ink">What RENKO recommended</h2>
          <div className="mt-4">
            <WhyThisFix fix={fix} />
          </div>
        </div>

        {item.outcome && (
          <div className="mt-6">
            <h2 className="text-h2 font-semibold text-ink">Outcome</h2>
            <div className="mt-4">
              <OutcomeCard outcome={item.outcome} />
            </div>
          </div>
        )}

        <Button variant="secondary" type="button" className="mt-6" onClick={() => setEvidenceOpen(true)}>
          Review the evidence
        </Button>

        <p className="mt-6 text-caption text-ink-muted">
          Limitations: this reflects observed Search Console metrics during the stated comparison window, not
          proof that this change alone caused the result.
        </p>

        <EvidenceDrawer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} fix={fix} />
      </Container>
    </div>
  );
}
