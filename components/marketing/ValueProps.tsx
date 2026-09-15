import { Container } from "@/components/ui/Container";

const values = [
  {
    title: "One decision",
    description: "No opportunity backlog to sort through. RENKO commits to a single recommendation at a time.",
  },
  {
    title: "Real evidence",
    description: "Every recommendation comes with the underlying Search Console data behind it, not a bare score.",
  },
  {
    title: "No false certainty",
    description: "When the data isn't strong enough to support a confident recommendation, RENKO says so instead of guessing.",
  },
  {
    title: "Measure the change",
    description: "After you make the change, RENKO checks performance again and shows you what actually happened.",
  },
];

export function ValueProps() {
  return (
    <section className="border-b border-line py-16 md:py-24">
      <Container width="page">
        <div className="divide-y divide-line border-t border-line">
          {values.map((value) => (
            <div key={value.title} className="grid gap-3 py-8 md:grid-cols-3 md:gap-8">
              <h3 className="text-h2 font-semibold text-ink">{value.title}</h3>
              <p className="max-w-editorial text-body-lg text-ink-muted md:col-span-2">{value.description}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
