import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Terms of Service",
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <div className="py-16 md:py-24">
      <Container>
        <h1 className="font-serif text-h1 text-ink">Terms of Service</h1>
        <p className="mt-6 max-w-editorial text-body-lg text-ink-muted">
          RENKO&apos;s terms of service are being finalized ahead of launch. This page is a
          placeholder route, not a published agreement — nothing here should be relied on yet.
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
