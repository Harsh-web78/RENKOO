import { Container } from "@/components/ui/Container";

const audiences = ["SEO specialists", "Freelancers", "Agencies", "Website owners", "Growth marketers"];

export function WhoItsFor() {
  return (
    <section className="border-b border-line py-16 md:py-24">
      <Container>
        <h2 className="font-serif text-h1 text-ink md:text-editorial-h1">Who RENKO is for</h2>
        <p className="mt-6 text-body-lg text-ink-muted">
          If you already have more SEO data than time to act on it, RENKO is for you — regardless of
          whether that data lives in your own Search Console account or a client&apos;s.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {audiences.map((audience) => (
            <span
              key={audience}
              className="rounded-xs border border-line px-3 py-1.5 text-body text-ink-muted"
            >
              {audience}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
}
