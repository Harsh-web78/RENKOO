"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { formatDate } from "@/lib/mock/product-service";
import { HistoryItem } from "@/lib/mock/types";
import { useSession } from "@/lib/mock/session-context";

const statusTone: Record<HistoryItem["status"], "brick" | "amber" | "neutral"> = {
  measured: "brick",
  waiting: "amber",
  dismissed: "neutral",
};
const statusLabel: Record<HistoryItem["status"], string> = {
  measured: "Measured",
  waiting: "Waiting for results",
  dismissed: "Dismissed",
};

function outcomeDelta(item: HistoryItem): string | null {
  if (!item.outcome?.after) return null;
  const delta = item.outcome.after.clicks - item.outcome.before.clicks;
  return `${delta >= 0 ? "+" : ""}${delta} clicks`;
}

export function HistoryContent() {
  const session = useSession();
  const propertyId = session.onboarding.propertyId;
  if (!propertyId) return null;

  const state = session.getPropertyState(propertyId);

  return (
    <div className="py-10 md:py-16">
      <Container width="page">
        <h1 className="font-serif text-h1 text-ink">History</h1>

        {state.history.length === 0 ? (
          <div className="mt-6 rounded-sm border border-line p-6">
            <p className="text-body-lg font-medium text-ink">No completed fixes yet.</p>
            <p className="mt-2 text-body text-ink-muted">
              Once you apply a RENKO recommendation, it will appear here with its measured result.
            </p>
            <Button variant="primary" type="button" className="mt-4" href={state.currentFix ? "/fixes" : "/home"}>
              {state.currentFix ? "View current fix" : "Return to Home"}
            </Button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col divide-y divide-line border-y border-line">
            {state.history.map((item) => {
              const delta = outcomeDelta(item);
              return (
                <Link
                  key={item.id}
                  href={`/history/${encodeURIComponent(item.id)}`}
                  className="flex flex-col gap-2 py-4 hover:bg-surface-sunken sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div>
                    <p className="text-body-lg font-medium text-ink">{item.recommendedChange}</p>
                    <p className="mt-0.5 text-caption text-ink-muted">
                      {item.page} · {item.appliedAt ? `Applied ${formatDate(item.appliedAt)}` : "Not applied"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {delta && <span className="text-body font-medium tabular-nums text-ink">{delta}</span>}
                    <Badge tone={statusTone[item.status]}>{statusLabel[item.status]}</Badge>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Container>
    </div>
  );
}
