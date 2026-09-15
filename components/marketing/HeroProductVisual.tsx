import { Badge } from "@/components/ui/Badge";
import { MetricStat } from "./MetricStat";

/**
 * A coded, restrained representation of the real RENKO product UI — not a
 * screenshot, not an illustration. Deliberately small and single-purpose:
 * one card, one recommendation, matching the "one thing" product principle.
 */
export function HeroProductVisual() {
  return (
    <div className="w-full max-w-[380px] rounded-sm border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <p className="text-caption font-medium tracking-wide text-ink-muted">Your next best fix</p>
        <Badge tone="neutral">Example</Badge>
      </div>

      <p className="mt-3 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-caption text-ink-muted">
        /pricing
      </p>

      <div className="mt-4 flex gap-8">
        <MetricStat label="Clicks" value="-34%" tone="rust" />
        <MetricStat label="Position" value="#4" />
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="text-caption font-medium text-ink-muted">Recommendation</p>
        <p className="mt-1 text-body font-medium text-ink">Rewrite the title to better match search intent.</p>
      </div>

      <div className="mt-4">
        <p className="text-caption font-medium text-ink-muted">Why</p>
        <p className="mt-1 text-body text-ink-muted">
          This page receives significant impressions but its click-through rate is below comparable queries.
        </p>
      </div>

      <p className="mt-5 text-body font-medium text-brick underline decoration-brick/30 underline-offset-4">
        Review the evidence
      </p>
    </div>
  );
}
