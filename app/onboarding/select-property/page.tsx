import type { Metadata } from "next";
import { SelectProperty } from "@/components/onboarding/SelectProperty";

export const metadata: Metadata = {
  title: "Select your website",
  robots: { index: false, follow: true },
};

export default function SelectPropertyPage() {
  return <SelectProperty />;
}
