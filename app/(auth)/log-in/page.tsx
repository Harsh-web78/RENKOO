import type { Metadata } from "next";
import { LogInForm } from "@/components/auth/LogInForm";

export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false, follow: true },
};

export default function LogInPage() {
  return <LogInForm />;
}
