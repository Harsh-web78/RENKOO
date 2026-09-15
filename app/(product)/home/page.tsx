import type { Metadata } from "next";
import { HomeContent } from "@/components/product/HomeContent";

export const metadata: Metadata = {
  title: "Home",
  robots: { index: false, follow: true },
};

export default function HomePage() {
  return <HomeContent />;
}
