import type { Metadata } from "next";
import { FirstFixReveal } from "@/components/onboarding/FirstFixReveal";

export const metadata: Metadata = {
  title: "Your next best fix",
  robots: { index: false, follow: true },
};

export default function FirstFixPage() {
  return <FirstFixReveal />;
}
