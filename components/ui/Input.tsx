import { InputHTMLAttributes, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helperText?: string;
  /** When set, overrides helperText with rust-colored error text and marks the field invalid. */
  error?: string;
}

export function Input({ label, helperText, error, id, className = "", ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const message = error ?? helperText;
  const helperId = message ? `${inputId}-helper` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-body font-medium text-ink">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={helperId}
        aria-invalid={Boolean(error) || undefined}
        className={`h-11 rounded-xs border px-3 text-body text-ink outline-none transition-colors duration-150 placeholder:text-ink-muted focus-visible:ring-2 ${
          error
            ? "border-rust focus-visible:border-rust focus-visible:ring-rust"
            : "border-line hover:border-line-strong focus-visible:border-brick focus-visible:ring-brick"
        } ${className}`}
        {...props}
      />
      {message && (
        <p id={helperId} className={`text-caption ${error ? "text-rust" : "text-ink-muted"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
