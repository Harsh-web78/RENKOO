import { ReactNode } from "react";

type Tone = "brick" | "amber" | "rust" | "neutral";

const tones: Record<Tone, string> = {
  brick: "bg-brick-tint text-brick",
  amber: "bg-amber-tint text-amber",
  rust: "bg-rust-tint text-rust",
  neutral: "bg-surface-sunken text-ink-muted",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-pill px-3 py-1 text-caption font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
