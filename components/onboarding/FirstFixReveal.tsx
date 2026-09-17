"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Drawer } from "@/components/ui/Drawer";
import { MetricStat } from "@/components/marketing/MetricStat";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

const stages = ["brand", "signal", "page", "finding", "change"] as const;
type Stage = (typeof stages)[number];

function useRevealStage(): Stage {
  const [stage, setStage] = useState<Stage>("brand");

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setStage("change");
      return;
    }
    const timers = stages.map((s, i) => setTimeout(() => setStage(s), i * 260));
    return () => timers.forEach(clearTimeout);
  }, []);

  return stage;
}

function stageAtLeast(current: Stage, target: Stage): boolean {
  return stages.indexOf(current) >= stages.indexOf(target);
}

export function FirstFixReveal() {
  const session = useSession();
  const router = useRouter();
  const stage = useRevealStage();
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const fix = session.onboarding.fix;
  // In real mode the fix comes from backend ingestion (see runRealAnalysis);
  // the demo labels below stay mock-only.
  const isReal = session.providerMode === "real";

  useEffect(() => {
    if (session.hydrated && !fix) {
      router.replace(resumeRoute(session.onboarding));
    }
  }, [session.hydrated, fix, session.onboarding, router]);

  if (!fix) return null;

  const fadeClass = (visible: boolean) =>
    `transition-all duration-200 ${visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`;

  return (
    <div className="py-16 md:py-24">
      <Container>
        <div className="mx-auto w-full max-w-[480px]">
          <p className={`text-caption font-medium tracking-wide text-ink-muted ${fadeClass(stageAtLeast(stage, "brand"))}`}>
            RENKO found a meaningful signal
          </p>

          <div className={`mt-8 rounded-sm border border-line bg-surface p-6 ${fadeClass(stageAtLeast(stage, "signal"))}`}>
            <div className="flex items-center justify-between">
              <p className="text-caption font-medium tracking-wide text-ink-muted">Your next best fix</p>
              {!isReal && <Badge tone="neutral">Demo data</Badge>}
            </div>

            <p className={`mt-3 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-caption text-ink-muted ${fadeClass(stageAtLeast(stage, "page"))}`}>
              {fix.page}
            </p>

            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <MetricStat label="Organic clicks" value={String(fix.clicks)} tone="rust" />
              <MetricStat label="Impressions" value={fix.impressions.toLocaleString()} />
              <MetricStat label="CTR" value={fix.ctr} />
              <MetricStat label="Position" value={fix.position.toFixed(1)} />
            </div>

            <div className={`mt-5 border-t border-line pt-4 ${fadeClass(stageAtLeast(stage, "finding"))}`}>
              <p className="text-caption font-medium text-ink-muted">Finding</p>
              <p className="mt-1 text-body text-ink">{fix.finding}</p>
            </div>

            <div className={`mt-4 ${fadeClass(stageAtLeast(stage, "change"))}`}>
              <p className="text-caption font-medium text-ink-muted">The change</p>
              <p className="mt-1 text-body font-medium text-ink">{fix.recommendedChange}</p>
            </div>

            <div className={`mt-4 ${fadeClass(stageAtLeast(stage, "change"))}`}>
              <p className="text-caption font-medium text-ink-muted">Why</p>
              <p className="mt-1 text-body text-ink-muted">{fix.why}</p>
            </div>
          </div>

          <div className={`mt-6 ${fadeClass(stageAtLeast(stage, "change"))}`}>
            <Button variant="primary" type="button" className="w-full" onClick={() => setEvidenceOpen(true)}>
              Review the evidence
            </Button>
            <Button variant="secondary" href="/home" className="mt-3 w-full">
              Go to your dashboard
            </Button>
            {!isReal && (
              <p className="mt-3 text-caption text-ink-muted">
                Illustrative demo data for this preview — not a real customer&apos;s Search Console data.
              </p>
            )}
          </div>
        </div>
      </Container>

      <Drawer open={evidenceOpen} onClose={() => setEvidenceOpen(false)} title="Evidence">
        <p className="text-body text-ink-muted">{fix.evidence.windowLabel}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-body">
            <thead>
              <tr className="border-b border-line-strong text-caption text-ink-muted">
                <th className="py-2 pr-4 font-medium">Query</th>
                <th className="py-2 pr-4 font-medium">Clicks</th>
                <th className="py-2 pr-4 font-medium">Impressions</th>
                <th className="py-2 pr-4 font-medium">CTR</th>
                <th className="py-2 font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {fix.evidence.rows.map((row) => (
                <tr key={row.query} className="border-b border-line">
                  <td className="py-2 pr-4 text-ink">{row.query}</td>
                  <td className="py-2 pr-4 tabular-nums text-ink">{row.clicks}</td>
                  <td className="py-2 pr-4 tabular-nums text-ink">{row.impressions.toLocaleString()}</td>
                  <td className="py-2 pr-4 tabular-nums text-ink">{row.ctr}</td>
                  <td className="py-2 tabular-nums text-ink">{row.position}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-6 rounded-sm bg-surface-sunken p-4 text-caption text-ink-muted">
          This is the evidence behind today&apos;s one recommendation. Tracking fixes over time and comparing
          results across your whole workspace is part of the RENKO product still to come.
        </p>
      </Drawer>
    </div>
  );
}
