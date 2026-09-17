"use client";

import { ReactNode } from "react";
import { SessionProvider } from "@/lib/mock/session-context";
import { resolveProviderKind } from "@/lib/data-contract/provider-selection";

/**
 * Centralized provider selection (Prompt 13 §6).
 *
 * `NEXT_PUBLIC_USE_REAL_PROVIDER=true` mounts the real-backend session;
 * anything else (default) keeps the mock provider. This is the ONLY place
 * that reads the flag for rendering — screens branch on
 * `useSession().providerMode`, never on `process.env`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <SessionProvider mode={resolveProviderKind()}>{children}</SessionProvider>;
}
