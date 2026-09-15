import type { Metadata } from "next";
import { Analyzing } from "@/components/onboarding/Analyzing";

export const metadata: Metadata = {
  title: "Analyzing your site",
  robots: { index: false, follow: true },
};

export default function AnalyzingPage() {
  return <Analyzing />;
}
