import { ProductFix } from "@/lib/mock/types";

export function WhyThisFix({ fix }: { fix: ProductFix }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-caption font-medium text-ink-muted">Observed</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-body text-ink">
          <li>
            Average position moved from {fix.positionBaseline.toFixed(1)} to {fix.position.toFixed(1)}.
          </li>
          <li>Clicks changed {fix.clicksDeltaPct}% during the comparison window.</li>
          <li>{fix.impressions.toLocaleString()} impressions, {fix.ctr} click-through rate.</li>
        </ul>
      </div>

      <div>
        <p className="text-caption font-medium text-ink-muted">Interpretation</p>
        <p className="mt-1.5 text-body text-ink">{fix.interpretation}</p>
      </div>

      <div>
        <p className="text-caption font-medium text-ink-muted">Recommendation</p>
        <p className="mt-1.5 text-body font-medium text-ink">{fix.recommendedChange}</p>
      </div>
    </div>
  );
}
