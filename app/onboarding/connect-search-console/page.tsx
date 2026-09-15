import type { Metadata } from "next";
import { ConnectSearchConsole } from "@/components/onboarding/ConnectSearchConsole";

export const metadata: Metadata = {
  title: "Connect Search Console",
  robots: { index: false, follow: true },
};

export default function ConnectSearchConsolePage() {
  return <ConnectSearchConsole />;
}
