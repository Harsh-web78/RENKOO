"use client";

import { useEffect, useState } from "react";
import { mockSearchConsoleService } from "@/lib/mock/search-console-service";
import { SearchConsoleProperty } from "@/lib/mock/types";
import { useSession } from "@/lib/mock/session-context";

const statusLabel: Record<SearchConsoleProperty["status"], string> = {
  healthy: "Connected",
  "needs-attention": "Needs attention",
  stale: "Stale",
  disconnected: "Disconnected",
};

export function PropertySwitcher() {
  const session = useSession();
  const [properties, setProperties] = useState<SearchConsoleProperty[]>([]);
  const activeId = session.onboarding.propertyId ?? "";

  useEffect(() => {
    mockSearchConsoleService.listProperties("success").then(setProperties);
  }, []);

  function handleChange(id: string) {
    session.setActiveProperty(id);
    session.ensurePropertyState(id);
  }

  if (properties.length === 0) return null;

  return (
    <label className="flex flex-col gap-1 px-1">
      <span className="text-caption font-medium text-ink-muted">Property</span>
      <select
        value={activeId}
        onChange={(e) => handleChange(e.target.value)}
        className="h-11 rounded-xs border border-line bg-surface px-2 text-body text-ink focus-visible:border-brick focus-visible:ring-2 focus-visible:ring-brick"
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {statusLabel[p.status]}
          </option>
        ))}
      </select>
    </label>
  );
}
