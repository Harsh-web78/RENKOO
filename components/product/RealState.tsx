import { Button } from "@/components/ui/Button";
import type { DataError } from "@/lib/data-contract/errors";
import { formatDate } from "@/lib/mock/product-service";

function errorTitle(error: DataError): string {
  switch (error.code) {
    case "AUTH_REQUIRED":
      return "Sign in required";
    case "PERMISSION_DENIED":
      return "No access to this workspace";
    case "RATE_LIMITED":
      return "Rate limited — try again shortly";
    case "PROPERTY_NOT_FOUND":
      return "Property not found";
    default:
      return "RENKO couldn't load this property";
  }
}

/**
 * Honest error panel for real-mode transport/auth errors — errors that
 * must never collapse into "No Fix". Uses the existing card style.
 */
export function RealErrorPanel({
  error,
  onRetry,
  retryLabel = "Try again",
}: {
  error: DataError;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-sm border border-line p-6" role="alert">
      <h2 className="text-h2 font-semibold text-ink">{errorTitle(error)}</h2>
      <p className="mt-2 text-body text-ink-muted">{error.message}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {onRetry && (
          <Button variant="primary" type="button" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {error.code === "AUTH_REQUIRED" && (
          <Button variant="secondary" href="/log-in">
            Sign in
          </Button>
        )}
      </div>
    </div>
  );
}

/** Loading skeleton for real-mode fetches — never mock data, never blank. */
export function RealLoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite" aria-label={label}>
      <p className="text-body text-ink-muted">{label}</p>
      <div className="h-[120px] animate-pulse rounded-sm border border-line bg-surface-sunken" aria-hidden="true" />
      <div className="h-[76px] animate-pulse rounded-sm border border-line bg-surface-sunken" aria-hidden="true" />
    </div>
  );
}

export function RealFooter({ propertyId }: { propertyId: string }) {
  return (
    <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 text-caption text-ink-muted">
      <span>Property: {propertyId}</span>
      <span>Live data via the RENKO API</span>
    </div>
  );
}

export function SessionFooter({ propertyId, lastCheckedAt, lastSuccessfulDataAt }: { propertyId: string; lastCheckedAt: string; lastSuccessfulDataAt: string }) {
  return (
    <div className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 text-caption text-ink-muted">
      <span>Property: {propertyId}</span>
      <span>Last checked: {formatDate(lastCheckedAt)}</span>
      <span>Data through: {formatDate(lastSuccessfulDataAt)}</span>
    </div>
  );
}
