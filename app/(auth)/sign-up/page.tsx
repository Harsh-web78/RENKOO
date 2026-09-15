import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/SignUpForm";

export const metadata: Metadata = {
  title: "Sign up",
  robots: { index: false, follow: true },
};

export default function SignUpPage() {
  return <SignUpForm />;
}
