import type { Metadata } from "next";
import { HistoryDetailContent } from "@/components/product/HistoryDetailContent";

export const metadata: Metadata = {
  title: "History detail",
  robots: { index: false, follow: true },
};

export default async function HistoryDetailPage({ params }: { params: Promise<{ fixId: string }> }) {
  const { fixId } = await params;
  return <HistoryDetailContent fixId={decodeURIComponent(fixId)} />;
}
