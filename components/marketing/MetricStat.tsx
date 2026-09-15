type Tone = "ink" | "rust" | "brick";

const toneClasses: Record<Tone, string> = {
  ink: "text-ink",
  rust: "text-rust",
  brick: "text-brick",
};

export function MetricStat({ label, value, tone = "ink" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div>
      <p className="text-caption text-ink-muted">{label}</p>
      <p className={`text-metric-s font-semibold tabular-nums ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}
