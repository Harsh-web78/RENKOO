import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ProductFix } from "@/lib/mock/types";

const statusBadge: Record<ProductFix["status"], { label: string; tone: "brick" | "amber" | "neutral" } | null> = {
  available: null,
  reviewed: { label: "Reviewed", tone: "neutral" },
  applied: { label: "Waiting for result", tone: "amber" },
  dismissed: null,
};

export function CurrentFixSummary({ fix }: { fix: ProductFix }) {
  const hasOutcome = Boolean(fix.outcome);
  const badge = hasOutcome ? { label: "Result ready", tone: "brick" as const } : statusBadge[fix.status];

  return (
    <div className="rounded-sm border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-caption font-medium tracking-wide text-ink-muted">Your next best fix</p>
        {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
      </div>

      <p className="mt-3 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-caption text-ink-muted">{fix.page}</p>

      <p className="mt-4 text-h2 font-semibold text-ink">{fix.recommendedChange}</p>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-caption font-medium text-ink-muted">Why</p>
        <p className="mt-1 text-body text-ink-muted">{fix.finding}</p>
      </div>

      <div className="mt-5 flex gap-6">
        <div>
          <p className="text-caption text-ink-muted">CTR</p>
          <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.ctr}</p>
        </div>
        <div>
          <p className="text-caption text-ink-muted">Position</p>
          <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.position.toFixed(1)}</p>
        </div>
      </div>

      <Button variant="primary" type="button" href="/fixes" className="mt-6">
        Review the fix
      </Button>
    </div>
  );
}
