import { Container } from "@/components/ui/Container";

const steps = [
  {
    title: "Connect Search Console",
    description: "Grant read-only access to your property. RENKO never edits your site on your behalf.",
  },
  {
    title: "RENKO finds the meaningful signal",
    description: "RENKO compares each page's recent performance against its own history to find what actually changed.",
  },
  {
    title: "Review one recommended change",
    description: "See the evidence behind the recommendation, then make the change yourself, wherever it lives.",
  },
  {
    title: "Measure what happened",
    description: "RENKO checks performance again after the change and shows you whether it worked.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-line py-16 md:py-24">
      <Container width="page">
        <h2 className="max-w-editorial font-serif text-h1 text-ink md:text-editorial-h1">How RENKO works</h2>

        <ol className="mt-12 grid gap-10 md:grid-cols-4 md:gap-8">
          {steps.map((step, i) => (
            <li key={step.title}>
              <span className="text-metric-l font-semibold text-brick">{i + 1}</span>
              <h3 className="mt-3 text-h3 font-semibold text-ink">{step.title}</h3>
              <p className="mt-2 text-body text-ink-muted">{step.description}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
