import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/mock/product-service";
import { FixOutcome } from "@/lib/mock/types";

const statusCopy: Record<FixOutcome["status"], { label: string; tone: "brick" | "amber" | "rust" | "neutral"; summary: string }> = {
  "positive-change": {
    label: "Results are in",
    tone: "brick",
    summary: "After the change, performance improved during the comparison window.",
  },
  "no-material-change": {
    label: "No material change",
    tone: "neutral",
    summary: "Performance held roughly steady after the change — within normal variation.",
  },
  "negative-change": {
    label: "Performance declined",
    tone: "rust",
    summary: "Performance moved in the wrong direction after the change during the comparison window.",
  },
  "insufficient-data": {
    label: "Not enough data to measure",
    tone: "neutral",
    summary: "There wasn't enough Search Console activity in the window to draw a reliable comparison.",
  },
  "data-delayed": {
    label: "Data delayed",
    tone: "amber",
    summary: "Search Console hasn't finished reporting data for the full measurement window yet.",
  },
  "conflicting-data": {
    label: "Conflicting signals",
    tone: "amber",
    summary: "Different metrics moved in different directions — the result isn't clear-cut.",
  },
  unavailable: {
    label: "Result unavailable",
    tone: "neutral",
    summary: "RENKO couldn't retrieve measurement data for this page.",
  },
};

export function OutcomeCard({ outcome }: { outcome: FixOutcome }) {
  const copy = statusCopy[outcome.status];

  return (
    <div className="rounded-sm border border-line p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h3 font-semibold text-ink">{copy.label}</h3>
        <Badge tone={copy.tone}>{outcome.status.replace(/-/g, " ")}</Badge>
      </div>
      <p className="mt-1 text-body text-ink-muted">{copy.summary}</p>

      {outcome.after && (
        <div className="mt-4 grid grid-cols-3 gap-4 border-t border-line pt-4">
          <div>
            <p className="text-caption text-ink-muted">Before</p>
            <p className="mt-1 text-body text-ink">{outcome.before.clicks} clicks</p>
            <p className="text-body text-ink">{outcome.before.ctr} CTR</p>
            <p className="text-body text-ink">Position {outcome.before.position.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">After</p>
            <p className="mt-1 text-body text-ink">{outcome.after.clicks} clicks</p>
            <p className="text-body text-ink">{outcome.after.ctr} CTR</p>
            <p className="text-body text-ink">Position {outcome.after.position.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">Change</p>
            <p className="mt-1 text-body font-medium text-ink">
              {outcome.after.clicks - outcome.before.clicks >= 0 ? "+" : ""}
              {outcome.after.clicks - outcome.before.clicks} clicks
            </p>
            <p className="text-body font-medium text-ink">
              {(outcome.after.position - outcome.before.position).toFixed(1)} position
            </p>
          </div>
        </div>
      )}

      {outcome.measuredAt && (
        <p className="mt-4 text-caption text-ink-muted">
          Measured {formatDate(outcome.measuredAt)}. This reflects the observed change during the comparison
          window, not a guarantee the recommendation alone caused it.
        </p>
      )}
    </div>
  );
}
