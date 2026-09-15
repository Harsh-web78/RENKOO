import { BillingCycle } from "@/lib/pricing-config";

export function BillingToggle({
  value,
  onChange,
}: {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Billing cycle" className="inline-flex rounded-xs border border-line p-1">
      {(["monthly", "annual"] as const).map((cycle) => (
        <button
          key={cycle}
          type="button"
          role="radio"
          aria-checked={value === cycle}
          onClick={() => onChange(cycle)}
          className={`rounded-xs px-4 py-1.5 text-body transition-colors duration-150 ${
            value === cycle ? "bg-brick text-white" : "text-ink-muted hover:text-ink"
          }`}
        >
          {cycle === "monthly" ? "Monthly" : "Annual"}
        </button>
      ))}
    </div>
  );
}
