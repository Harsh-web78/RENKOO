import type { Metadata } from "next";
import { CreateWorkspaceForm } from "@/components/onboarding/CreateWorkspaceForm";

export const metadata: Metadata = {
  title: "Create your workspace",
  robots: { index: false, follow: true },
};

export default function CreateWorkspacePage() {
  return <CreateWorkspaceForm />;
}
