import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: true },
};

const sections = [
  { title: "Workspace", description: "Rename your workspace and manage who has access." },
  { title: "Connections", description: "Manage your Google Search Console connection and properties." },
  { title: "Billing", description: "Plan, payment method, and invoices." },
  { title: "Account", description: "Your email, password, and notification preferences." },
];

export default function SettingsPage() {
  return (
    <div className="py-10 md:py-16">
      <Container>
        <h1 className="font-serif text-h1 text-ink">Settings</h1>
        <p className="mt-2 text-body text-ink-muted">
          Full settings management is coming in a later phase. Here&apos;s what will live here.
        </p>

        <div className="mt-6 flex flex-col divide-y divide-line border-y border-line">
          {sections.map((section) => (
            <div key={section.title} className="py-4">
              <p className="text-body-lg font-medium text-ink">{section.title}</p>
              <p className="mt-1 text-body text-ink-muted">{section.description}</p>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
}
