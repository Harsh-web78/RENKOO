import { Container } from "@/components/ui/Container";

const traditional = ["Keywords", "Rankings", "Traffic", "Audits", "Backlinks", "Reports", "Charts"];
const renkoFlow = ["Search Console data", "RENKO finds the meaningful signal", "One recommendation", "One action"];

function ArrowDown() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="my-1 h-4 w-4 text-ink-muted/60">
      <path d="M8 2v10M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function ProblemSection() {
  return (
    <section id="product" className="border-b border-line py-16 md:py-24">
      <Container width="page">
        <h2 className="max-w-editorial font-serif text-h1 text-ink md:text-editorial-h1">
          SEO tools give you more data. They don&apos;t tell you what to do with it.
        </h2>

        <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <p className="text-caption font-medium text-ink-muted">Traditional workflow</p>
            <div className="mt-4 flex flex-col items-start">
              {traditional.map((item, i) => (
                <div key={item} className="flex flex-col items-start">
                  <span className="rounded-xs border border-line px-3 py-1.5 text-body text-ink-muted">{item}</span>
                  {i < traditional.length - 1 && <ArrowDown />}
                </div>
              ))}
              <ArrowDown />
              <span className="text-body font-medium text-ink">You decide what matters</span>
            </div>
          </div>

          <div>
            <p className="text-caption font-medium text-ink-muted">RENKO</p>
            <div className="mt-4 flex flex-col items-start">
              {renkoFlow.map((item, i) => (
                <div key={item} className="flex flex-col items-start">
                  <span
                    className={
                      i === renkoFlow.length - 1
                        ? "rounded-xs bg-brick px-3 py-1.5 text-body font-medium text-white"
                        : "rounded-xs border border-line-strong px-3 py-1.5 text-body text-ink"
                    }
                  >
                    {item}
                  </span>
                  {i < renkoFlow.length - 1 && <ArrowDown />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
