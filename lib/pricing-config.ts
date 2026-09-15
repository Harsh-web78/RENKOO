/**
 * RENKO pricing configuration.
 *
 * These are pre-configured *display* prices per currency/region — not a
 * live currency-conversion calculation. When a backend pricing service
 * exists, it should return data shaped like `PricingPlan` below (or this
 * file can be replaced by a fetch to that service); no component in this
 * codebase should ever need to change to support that swap.
 */

export type CurrencyCode = "USD" | "INR" | "EUR" | "GBP";

export interface CurrencyMeta {
  code: CurrencyCode;
  symbol: string;
  label: string;
  locale: string;
}

export const currencies: Record<CurrencyCode, CurrencyMeta> = {
  USD: { code: "USD", symbol: "$", label: "USD", locale: "en-US" },
  INR: { code: "INR", symbol: "₹", label: "INR", locale: "en-IN" },
  EUR: { code: "EUR", symbol: "€", label: "EUR", locale: "en-IE" },
  GBP: { code: "GBP", symbol: "£", label: "GBP", locale: "en-GB" },
};

export type BillingCycle = "monthly" | "annual";

/**
 * Account-side pricing states. The public pricing page renders in the
 * default "choose" state for anonymous visitors. The remaining states exist
 * so the same <PricingCard> can be reused, unchanged, inside the logged-in
 * Settings → Billing screen in a later phase — no mock payment is implied
 * by any of them.
 */
export type PricingCardState =
  | "choose" // default public state — no account context
  | "current" // this is the account's active plan
  | "trial" // trial in progress, plenty of time left
  | "trial-ending" // trial ending soon — matches Home/Billing banner copy
  | "upgrade-available"
  | "downgrade-available"
  | "payment-failed"
  | "expired"; // subscription lapsed — read-only mode

export interface PricingPlan {
  id: "solo" | "agency";
  name: string;
  tagline: string;
  description: string;
  propertyLimit: string;
  features: string[];
  recommended: boolean;
  monthlyPrice: Record<CurrencyCode, number>;
  /** Monthly-equivalent price when billed annually (displayed as "/mo"). */
  annualMonthlyEquivalent: Record<CurrencyCode, number>;
}

export const pricingPlans: PricingPlan[] = [
  {
    id: "solo",
    name: "Solo",
    tagline: "For one specialist, one site at a time",
    description:
      "Everything you need to find and track the next SEO fix for a single property.",
    propertyLimit: "1 connected property",
    features: [
      "One recommended fix at a time, ranked by evidence",
      "Full Search Console evidence for every recommendation",
      "Before/after performance tracking",
      "Weekly re-analysis",
    ],
    recommended: false,
    monthlyPrice: { USD: 29, INR: 1999, EUR: 27, GBP: 23 },
    annualMonthlyEquivalent: { USD: 24, INR: 1666, EUR: 22, GBP: 19 },
  },
  {
    id: "agency",
    name: "Agency",
    tagline: "For teams managing multiple client sites",
    description:
      "The same one-fix-at-a-time workflow, run separately across every client property.",
    propertyLimit: "Up to 10 connected properties",
    features: [
      "Everything in Solo, per connected property",
      "Per-client history and evidence exports",
      "Team member access",
      "Priority support",
    ],
    recommended: true,
    monthlyPrice: { USD: 89, INR: 5999, EUR: 79, GBP: 69 },
    annualMonthlyEquivalent: { USD: 74, INR: 4999, EUR: 66, GBP: 57 },
  },
];

export function formatPrice(amount: number, currency: CurrencyCode): string {
  const meta = currencies[currency];
  // Whole-number plan prices — no decimal noise, matches the source pricing brief.
  const formatted = new Intl.NumberFormat(meta.locale, {
    maximumFractionDigits: 0,
  }).format(amount);
  return `${meta.symbol}${formatted}`;
}
