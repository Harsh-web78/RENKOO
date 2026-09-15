"use client";

import { useState } from "react";
import { BillingCycle, CurrencyCode, PricingPlan } from "@/lib/pricing-config";
import { BillingToggle } from "./BillingToggle";
import { CurrencySelect } from "./CurrencySelect";
import { PricingCard } from "./PricingCard";

export function PricingInteractive({ plans }: { plans: PricingPlan[] }) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");

  return (
    <div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <BillingToggle value={cycle} onChange={setCycle} />
        <CurrencySelect value={currency} onChange={setCurrency} />
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {plans.map((plan) => (
          <PricingCard key={plan.id} plan={plan} currency={currency} cycle={cycle} />
        ))}
      </div>

      <p className="mt-4 text-caption text-ink-muted">
        Prices shown are configured display prices for your region, not a live currency conversion.
      </p>
    </div>
  );
}
