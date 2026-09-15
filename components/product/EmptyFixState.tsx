import { Button } from "@/components/ui/Button";
import { formatDate } from "@/lib/mock/product-service";
import { NoFixReason } from "@/lib/mock/types";

export function EmptyFixState({
  reason,
  lastCheckedAt,
  nextCheckAt,
  lastSuccessfulDataAt,
  onRefresh,
  onCheckAgain,
  onTryAgain,
}: {
  reason: NoFixReason;
  lastCheckedAt: string;
  nextCheckAt: string;
  lastSuccessfulDataAt: string;
  onRefresh?: () => void;
  onCheckAgain?: () => void;
  onTryAgain?: () => void;
}) {
  if (reason === "insufficient-data") {
    return (
      <div className="rounded-sm border border-line p-6">
        <h2 className="text-h2 font-semibold text-ink">Not enough data yet</h2>
        <p className="mt-2 text-body text-ink-muted">
          RENKO doesn&apos;t have enough reliable Search Console history to recommend a change for this property.
        </p>
        <p className="mt-2 text-body text-ink-muted">
          What&apos;s missing: more indexed traffic history and meaningful search activity to compare against.
        </p>
        {onCheckAgain && (
          <Button variant="secondary" type="button" className="mt-4" onClick={onCheckAgain}>
            Check again
          </Button>
        )}
      </div>
    );
  }

  if (reason === "stale-data") {
    return (
      <div className="rounded-sm border border-line p-6">
        <h2 className="text-h2 font-semibold text-ink">Search Console data is stale</h2>
        <p className="mt-2 text-body text-ink-muted">Last successful data: {formatDate(lastSuccessfulDataAt)}.</p>
        {onRefresh && (
          <Button variant="primary" type="button" className="mt-4" onClick={onRefresh}>
            Refresh data
          </Button>
        )}
      </div>
    );
  }

  if (reason === "connection-error") {
    return (
      <div className="rounded-sm border border-line p-6">
        <h2 className="text-h2 font-semibold text-ink">RENKO couldn&apos;t reach Search Console</h2>
        <p className="mt-2 text-body text-ink-muted">
          Your last successful data is still available from {formatDate(lastSuccessfulDataAt)}.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {onTryAgain && (
            <Button variant="primary" type="button" onClick={onTryAgain}>
              Try again
            </Button>
          )}
          <Button variant="secondary" href="/onboarding/connect-search-console">
            Reconnect Search Console
          </Button>
        </div>
      </div>
    );
  }

  // reason === "no-fix"
  return (
    <div className="rounded-sm border border-line p-6">
      <h2 className="text-h2 font-semibold text-ink">Nothing worth changing yet</h2>
      <p className="mt-2 text-body text-ink-muted">
        RENKO checked the available Search Console data and didn&apos;t find a change strong enough to recommend.
        This isn&apos;t an error.
      </p>
      <p className="mt-4 text-caption text-ink-muted">
        Last checked: {formatDate(lastCheckedAt)} · Next check: {formatDate(nextCheckAt)}
      </p>
    </div>
  );
}
