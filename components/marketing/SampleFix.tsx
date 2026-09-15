import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { MetricStat } from "./MetricStat";

export function SampleFix() {
  return (
    <section className="border-b border-line py-16 md:py-24">
      <Container width="page">
        <div className="grid gap-10 md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="max-w-editorial font-serif text-h1 text-ink md:text-editorial-h1">
              What a fix actually looks like
            </h2>
            <p className="mt-6 max-w-editorial text-body-lg text-ink-muted">
              Every RENKO recommendation is built the same way: an observation from your Search Console
              data, a specific finding, one recommended change, and a plan to measure whether it worked.
            </p>
          </div>

          <div className="rounded-sm border border-line bg-surface p-6">
            <div className="flex items-center justify-between">
              <p className="text-caption font-medium tracking-wide text-ink-muted">Your next best fix</p>
              <Badge tone="neutral">Example</Badge>
            </div>
            <p className="mt-2 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-caption text-ink-muted">
              /pricing
            </p>

            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5 sm:grid-cols-4">
              <MetricStat label="Impressions" value="2,840" />
              <MetricStat label="Clicks" value="74" />
              <MetricStat label="CTR" value="2.6%" tone="rust" />
              <MetricStat label="Position" value="4.2" />
            </div>

            <dl className="mt-6 flex flex-col gap-4 border-t border-line pt-5">
              <div>
                <dt className="text-caption font-medium text-ink-muted">Finding</dt>
                <dd className="mt-1 text-body text-ink">
                  This page receives strong impressions but a weaker click-through rate than expected for
                  its position.
                </dd>
              </div>
              <div>
                <dt className="text-caption font-medium text-ink-muted">Recommended change</dt>
                <dd className="mt-1 text-body font-medium text-ink">
                  Rewrite the title to match the search intent more directly.
                </dd>
              </div>
              <div>
                <dt className="text-caption font-medium text-ink-muted">Evidence</dt>
                <dd className="mt-1 text-body text-ink-muted">
                  Search Console data from the selected comparison window.
                </dd>
              </div>
              <div>
                <dt className="text-caption font-medium text-ink-muted">Action</dt>
                <dd className="mt-1 text-body text-ink-muted">Update the title, then RENKO measures the result.</dd>
              </div>
            </dl>
          </div>
        </div>

        <p className="mt-4 text-caption text-ink-muted">
          Illustrative example based on typical Search Console patterns — not a real customer result.
        </p>
      </Container>
    </section>
  );
}
