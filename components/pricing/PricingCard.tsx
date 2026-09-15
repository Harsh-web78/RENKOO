import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  BillingCycle,
  CurrencyCode,
  formatPrice,
  PricingCardState,
  PricingPlan,
} from "@/lib/pricing-config";

interface StateConfig {
  badgeLabel?: string;
  badgeTone: "brick" | "amber" | "rust" | "neutral";
  ctaLabel: string;
  ctaVariant: "primary" | "secondary";
  note?: string;
}

/**
 * Every mock account state the pricing UI needs to support. The public
 * /pricing page only ever renders "choose" (no account context yet). The
 * rest exist so this component can be dropped into the logged-in
 * Settings → Billing screen in a later phase without changes — no payment
 * is implied or processed by any of these.
 */
function getStateConfig(state: PricingCardState, recommended: boolean): StateConfig {
  switch (state) {
    case "current":
      return { badgeLabel: "Current plan", badgeTone: "brick", ctaLabel: "Manage billing", ctaVariant: "secondary" };
    case "trial":
      return { badgeLabel: "Trial active", badgeTone: "neutral", ctaLabel: "Add payment method", ctaVariant: "secondary" };
    case "trial-ending":
      return {
        badgeLabel: "Trial ending soon",
        badgeTone: "amber",
        ctaLabel: "Add payment method",
        ctaVariant: "primary",
        note: "Add a payment method to keep access when your trial ends.",
      };
    case "upgrade-available":
      return { ctaLabel: "Upgrade", ctaVariant: "primary", badgeTone: "neutral" };
    case "downgrade-available":
      return { ctaLabel: "Downgrade", ctaVariant: "secondary", badgeTone: "neutral" };
    case "payment-failed":
      return {
        badgeLabel: "Payment failed",
        badgeTone: "rust",
        ctaLabel: "Update payment method",
        ctaVariant: "primary",
        note: "We couldn't process your last payment.",
      };
    case "expired":
      return {
        badgeLabel: "Subscription expired",
        badgeTone: "rust",
        ctaLabel: "Reactivate",
        ctaVariant: "primary",
        note: "Your account is in read-only mode until this is resolved.",
      };
    case "choose":
    default:
      return {
        badgeLabel: recommended ? "Recommended" : undefined,
        badgeTone: "brick",
        ctaLabel: "Get started",
        ctaVariant: recommended ? "primary" : "secondary",
      };
  }
}

export function PricingCard({
  plan,
  currency,
  cycle,
  state = "choose",
}: {
  plan: PricingPlan;
  currency: CurrencyCode;
  cycle: BillingCycle;
  state?: PricingCardState;
}) {
  const config = getStateConfig(state, plan.recommended);
  const price = cycle === "monthly" ? plan.monthlyPrice[currency] : plan.annualMonthlyEquivalent[currency];

  return (
    <div
      className={`flex flex-col rounded-sm border p-6 ${
        plan.recommended ? "border-line-strong" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-h2 font-semibold text-ink">{plan.name}</h3>
          <p className="mt-1 text-body text-ink-muted">{plan.tagline}</p>
        </div>
        {config.badgeLabel && <Badge tone={config.badgeTone}>{config.badgeLabel}</Badge>}
      </div>

      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="text-metric-l font-semibold tabular-nums text-ink">{formatPrice(price, currency)}</span>
        <span className="text-body text-ink-muted">/mo</span>
      </div>
      {cycle === "annual" && <p className="mt-1 text-caption text-ink-muted">Billed annually</p>}

      <p className="mt-4 text-body text-ink-muted">{plan.propertyLimit}</p>

      <ul className="mt-6 flex flex-col gap-3 border-t border-line pt-6">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2.5 text-body text-ink">
            <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 flex-shrink-0 text-brick">
              <path
                d="M4 10.5l3.5 3.5L16 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-8">
        <Button href="/sign-up" variant={config.ctaVariant} className="w-full">
          {config.ctaLabel}
        </Button>
        {config.note && <p className="mt-3 text-caption text-ink-muted">{config.note}</p>}
      </div>
    </div>
  );
}
