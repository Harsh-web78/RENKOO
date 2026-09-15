import { ReactNode } from "react";

type Tone = "info" | "warning" | "danger" | "success";

const toneStyles: Record<Tone, { bg: string; text: string }> = {
  info: { bg: "bg-surface-sunken", text: "text-ink" },
  warning: { bg: "bg-amber-tint", text: "text-amber" },
  danger: { bg: "bg-rust-tint", text: "text-rust" },
  success: { bg: "bg-brick-tint", text: "text-brick" },
};

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "success") {
    return (
      <path d="M4 10.5l3.5 3.5L16 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    );
  }
  if (tone === "danger" || tone === "warning") {
    return (
      <>
        <path d="M10 6v5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="10" cy="14" r="0.9" fill="currentColor" />
      </>
    );
  }
  return <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.4" fill="none" />;
}

export function Alert({
  tone = "info",
  children,
  action,
  role,
}: {
  tone?: Tone;
  children: ReactNode;
  action?: ReactNode;
  /** Use "alert" for errors that need immediate announcement, "status" otherwise. */
  role?: "alert" | "status";
}) {
  const styles = toneStyles[tone];
  return (
    <div
      role={role ?? (tone === "danger" ? "alert" : "status")}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      className={`flex items-start gap-3 rounded-sm px-4 py-3 text-body ${styles.bg} ${styles.text}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 flex-shrink-0">
        <ToneIcon tone={tone} />
      </svg>
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}
