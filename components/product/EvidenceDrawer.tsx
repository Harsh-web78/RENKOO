"use client";

import { Drawer } from "@/components/ui/Drawer";
import { formatDate } from "@/lib/mock/product-service";
import { ProductFix } from "@/lib/mock/types";
import { WhyThisFix } from "./WhyThisFix";

export function EvidenceDrawer({
  open,
  onClose,
  fix,
}: {
  open: boolean;
  onClose: () => void;
  fix: ProductFix;
}) {
  const meta = fix.dataMeta;

  return (
    <Drawer open={open} onClose={onClose} title="Evidence">
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-caption font-medium text-ink-muted">Page</p>
          <p className="mt-1 inline-block rounded-xs bg-surface-sunken px-2 py-1 text-body text-ink">{fix.page}</p>
        </div>

        <dl className="grid grid-cols-2 gap-4 border-y border-line py-4 text-body sm:grid-cols-4">
          <div>
            <dt className="text-caption text-ink-muted">Source</dt>
            <dd className="mt-0.5 text-ink">{meta.source.label}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-muted">Data through</dt>
            <dd className="mt-0.5 text-ink">{formatDate(meta.dataThrough)}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-muted">Comparison</dt>
            <dd className="mt-0.5 text-ink">{meta.period.label}</dd>
          </div>
          <div>
            <dt className="text-caption text-ink-muted">Last updated</dt>
            <dd className="mt-0.5 text-ink">{formatDate(meta.retrievedAt)}</dd>
          </div>
        </dl>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-caption text-ink-muted">Clicks</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.clicks}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">Impressions</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.impressions.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">CTR</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.ctr}</p>
          </div>
          <div>
            <p className="text-caption text-ink-muted">Position</p>
            <p className="text-metric-s font-semibold tabular-nums text-ink">{fix.position.toFixed(1)}</p>
          </div>
        </div>

        {fix.evidence.rows.length > 0 && (
          <div className="overflow-x-auto">
            <p className="mb-2 text-caption font-medium text-ink-muted">Query-level evidence</p>
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
        )}

        {meta.limitations.length > 0 && (
          <div className="rounded-sm bg-surface-sunken p-4">
            <p className="text-caption font-medium text-ink-muted">Limitations</p>
            <ul className="mt-1 flex flex-col gap-1 text-body text-ink-muted">
              {meta.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="border-t border-line pt-5">
          <WhyThisFix fix={fix} />
        </div>
      </div>
    </Drawer>
  );
}
