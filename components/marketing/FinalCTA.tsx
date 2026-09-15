import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

export function FinalCTA() {
  return (
    <section className="py-16 md:py-24">
      <Container>
        <div className="text-center">
          <h2 className="font-serif text-h1 text-ink md:text-editorial-h1">
            Stop deciding what to fix. Let RENKO find the next one.
          </h2>
          <div className="mt-8 flex justify-center">
            <Button href="/sign-up" variant="primary">
              Connect Search Console
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
