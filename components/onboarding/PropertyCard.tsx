import { Badge } from "@/components/ui/Badge";
import { PropertyStatus, SearchConsoleProperty } from "@/lib/mock/types";

const statusConfig: Record<PropertyStatus, { label: string; tone: "brick" | "amber" | "rust" | "neutral" }> = {
  healthy: { label: "Connected", tone: "brick" },
  "needs-attention": { label: "Needs attention", tone: "amber" },
  stale: { label: "Data stale", tone: "amber" },
  disconnected: { label: "Disconnected", tone: "rust" },
};

const typeLabel: Record<SearchConsoleProperty["type"], string> = {
  domain: "Domain property",
  "url-prefix": "URL-prefix property",
};

export function PropertyCard({
  property,
  selected,
  onSelect,
}: {
  property: SearchConsoleProperty;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const status = statusConfig[property.status];
  const disabled = !property.selectable;

  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-sm border p-4 transition-colors duration-150 has-[:checked]:border-brick has-[:checked]:bg-brick-tint ${
        disabled ? "cursor-not-allowed border-line bg-surface-sunken opacity-70" : "border-line hover:border-line-strong"
      }`}
    >
      <input
        type="radio"
        name="property"
        className="mt-0.5 h-4 w-4 accent-brick"
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect(property.id)}
      />
      <div className="flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-body-lg font-medium text-ink">{property.name}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="mt-1 text-caption text-ink-muted">{typeLabel[property.type]}</p>
        {property.status === "disconnected" && (
          <p className="mt-2 text-caption text-rust">This property needs to be reconnected in Search Console.</p>
        )}
        {property.status === "stale" && (
          <p className="mt-2 text-caption text-amber">Last synced more than 7 days ago — still selectable.</p>
        )}
      </div>
    </label>
  );
}
