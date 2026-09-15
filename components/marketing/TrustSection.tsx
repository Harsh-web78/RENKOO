import { Container } from "@/components/ui/Container";

const principles = [
  "Evidence before action — every recommendation is backed by data you can check yourself.",
  "No unexplained scores — RENKO shows its reasoning in plain language, not a bare confidence number.",
  "No false certainty — when the data doesn't support a confident recommendation, RENKO says so.",
  "No automated site changes — RENKO is read-only until you confirm you've made a change yourself.",
];

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 flex-shrink-0 text-brick">
      <path
        d="M4 10.5l3.5 3.5L16 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function TrustSection() {
  return (
    <section className="border-b border-line py-16 md:py-24">
      <Container width="page">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="max-w-editorial font-serif text-h1 text-ink md:text-editorial-h1">
              Built to earn trust, not claim it
            </h2>
            <p className="mt-6 max-w-editorial text-body-lg text-ink-muted">
              RENKO is new. Rather than manufacture proof it hasn&apos;t earned yet, here&apos;s what
              governs how it behaves.
            </p>
          </div>

          <ul className="flex flex-col gap-5">
            {principles.map((principle) => (
              <li key={principle} className="flex gap-3">
                <CheckIcon />
                <span className="text-body-lg text-ink">{principle}</span>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
