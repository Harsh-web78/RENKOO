"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ApplyConfirmModal } from "./ApplyConfirmModal";
import { DismissModal } from "./DismissModal";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { OutcomeCard } from "./OutcomeCard";
import { formatDate } from "@/lib/mock/product-service";
import { DismissReason, ProductFix } from "@/lib/mock/types";
import { useSession } from "@/lib/mock/session-context";

export function FixWorkspace({ propertyId, fix }: { propertyId: string; fix: ProductFix }) {
  const session = useSession();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);

  function openEvidence() {
    if (fix.status === "available") session.markFixReviewed(propertyId);
    setEvidenceOpen(true);
  }

  function confirmApply() {
    session.applyFix(propertyId);
    setApplyOpen(false);
  }

  function confirmDismiss(reason: DismissReason) {
    session.dismissFix(propertyId, reason);
    setDismissOpen(false);
  }

  const isWaiting = fix.status === "applied" && !fix.outcome;
  const hasOutcome = Boolean(fix.outcome);
  const canAct = fix.status === "available" || fix.status === "reviewed";

  // Real mode: backend owns the lifecycle; surface action errors and the
  // honest measurement-pending notice instead of mock preview copy.
  const isReal = session.providerMode === "real";
  const realPending = isReal && session.realActionPending;
  const realError = isReal ? session.realActionError : null;
  const pendingNotice = isReal ? (session.measurementNotice[propertyId] ?? null) : null;

  return (
    <div className="mx-auto w-full max-w-content">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-h1 text-ink">Current fix</h1>
        {isWaiting && <Badge tone="amber">Waiting for result</Badge>}
        {hasOutcome && <Badge tone="brick">Result ready</Badge>}
      </div>

      <div className="mt-6 rounded-sm border border-line bg-surface p-6">
        <p className="inline-block rounded-xs bg-surface-sunken px-2 py-1 text-caption text-ink-muted">{fix.page}</p>
        <p className="mt-4 text-h2 font-semibold text-ink">{fix.recommendedChange}</p>
        <p className="mt-2 text-body text-ink-muted">{fix.finding}</p>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
          <div>
            <p className="text-caption text-ink-muted">Clicks</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.clicks}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">Impressions</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.impressions.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">CTR</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.ctr}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">Position</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.position.toFixed(1)}</p>
          </div>
        </div>

        <Button variant="secondary" type="button" className="mt-5" onClick={openEvidence}>
          Review the evidence
        </Button>
      </div>

      {canAct && (
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" type="button" onClick={() => setApplyOpen(true)} disabled={realPending}>
            Mark as applied
          </Button>
          <Button variant="ghost" type="button" onClick={() => setDismissOpen(true)} disabled={realPending}>
            Not relevant
          </Button>
        </div>
      )}

      {realError && (
        <div className="mt-6">
          <Alert tone="danger">{realError.message}</Alert>
        </div>
      )}

      {isWaiting && fix.baseline && (
        <div className="mt-6 rounded-sm border border-line p-6" role="status" aria-live="polite">
          <p className="text-body-lg font-medium text-ink">✓ Change marked as applied. Baseline captured.</p>
          <p className="mt-2 text-body text-ink-muted">
            RENKO will check the page again after the measurement window — it doesn&apos;t claim success before
            then.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
            <div>
              <dt className="text-caption text-ink-muted">Applied</dt>
              <dd className="mt-0.5 text-body text-ink">{formatDate(fix.appliedAt!)}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Baseline clicks</dt>
              <dd className="mt-0.5 text-body text-ink">{fix.baseline.clicks}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Baseline CTR</dt>
              <dd className="mt-0.5 text-body text-ink">{fix.baseline.ctr}</dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">Baseline position</dt>
              <dd className="mt-0.5 text-body text-ink">{fix.baseline.position.toFixed(1)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-body text-ink-muted">
            Results expected around {formatDate(fix.expectedMeasurementDate!)}.
          </p>
          {pendingNotice && (
            <p className="mt-2 text-body text-ink-muted" role="status">
              {pendingNotice}
            </p>
          )}
          <Button
            variant="secondary"
            type="button"
            className="mt-4"
            onClick={() => session.checkForResults(propertyId)}
            disabled={realPending}
          >
            Check for results now
          </Button>
          {!isReal && (
            <p className="mt-2 text-caption text-ink-muted">
              For this preview, you can check immediately instead of waiting for the real measurement window.
            </p>
          )}
        </div>
      )}

      {hasOutcome && fix.outcome && (
        <div className="mt-6" role="status" aria-live="polite">
          <OutcomeCard outcome={fix.outcome} />
          <Button variant="secondary" type="button" className="mt-4" onClick={() => session.acknowledgeOutcome(propertyId)}>
            Got it — look for the next fix
          </Button>
        </div>
      )}

      <EvidenceDrawer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} fix={fix} />
      <ApplyConfirmModal open={applyOpen} onClose={() => setApplyOpen(false)} onConfirm={confirmApply} />
      <DismissModal open={dismissOpen} onClose={() => setDismissOpen(false)} onConfirm={confirmDismiss} />
    </div>
  );
}
