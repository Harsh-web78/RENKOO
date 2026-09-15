import type { Metadata } from "next";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Contact",
  robots: { index: false, follow: true },
};

export default function ContactPage() {
  return (
    <div className="py-16 md:py-24">
      <Container>
        <h1 className="font-serif text-h1 text-ink">Contact</h1>
        <p className="mt-6 max-w-editorial text-body-lg text-ink-muted">
          For questions about RENKO, reach out at{" "}
          <a href="mailto:hello@renko.app" className="font-medium text-brick underline underline-offset-4">
            hello@renko.app
          </a>
          . A dedicated contact flow is coming as part of a later phase.
        </p>
      </Container>
    </div>
  );
}
