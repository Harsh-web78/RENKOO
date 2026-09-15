import { ReactNode } from "react";
import { Logo } from "./Logo";

/**
 * Used by the (auth) and onboarding layouts. Deliberately not the full
 * <SiteHeader> — auth/onboarding are focused, single-task flows and
 * showing the marketing nav (Product / How it works / Pricing) here would
 * be a distraction mid-task, not a consistency win.
 */
export function MinimalHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between px-6 md:px-8">
        <Logo />
        {right}
      </div>
    </header>
  );
}
