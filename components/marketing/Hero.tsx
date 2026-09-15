import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { HeroProductVisual } from "./HeroProductVisual";

export function Hero() {
  return (
    <section className="border-b border-line py-16 md:py-24">
      <Container width="page">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-body text-ink-muted">SEO decisions, without the noise.</p>
            <h1 className="mt-4 max-w-editorial font-serif text-editorial-h1 text-ink">
              Find the one SEO change worth making next.
            </h1>
            <p className="mt-6 max-w-editorial text-body-lg text-ink-muted">
              RENKO analyzes your Search Console data and surfaces the single change most worth
              making — with the evidence behind it.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/sign-up" variant="primary">
                Connect Search Console
              </Button>
              <Button href="#how-it-works" variant="secondary">
                See how it works
              </Button>
            </div>
          </div>

          <div className="flex justify-center md:justify-end">
            <HeroProductVisual />
          </div>
        </div>
      </Container>
    </section>
  );
}
