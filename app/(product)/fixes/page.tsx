import type { Metadata } from "next";
import { FixesContent } from "@/components/product/FixesContent";

export const metadata: Metadata = {
  title: "Fixes",
  robots: { index: false, follow: true },
};

export default function FixesPage() {
  return <FixesContent />;
}
