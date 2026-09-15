import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Privacy Policy",
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <div className="py-16 md:py-24">
      <Container>
        <h1 className="font-serif text-h1 text-ink">Privacy Policy</h1>
        <p className="mt-6 max-w-editorial text-body-lg text-ink-muted">
          RENKO&apos;s privacy policy is being finalized ahead of launch. This page is a placeholder
          route, not a published policy — nothing here should be relied on yet.
        </p>
        <p className="mt-4 max-w-editorial text-body text-ink-muted">
          Questions in the meantime can go to{" "}
          <a href="/contact" className="font-medium text-brick underline underline-offset-4">
            contact
          </a>
          .
        </p>
      </Container>
    </div>
  );
}
