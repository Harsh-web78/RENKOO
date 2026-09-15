"use client";

import { ReactNode } from "react";
import { SessionProvider } from "@/lib/mock/session-context";

export function AppProviders({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
