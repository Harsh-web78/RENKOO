import type { Metadata } from "next";
import { HistoryContent } from "@/components/product/HistoryContent";

export const metadata: Metadata = {
  title: "History",
  robots: { index: false, follow: true },
};

export default function HistoryPage() {
  return <HistoryContent />;
}
