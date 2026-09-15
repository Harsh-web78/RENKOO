"use client";

import { InputHTMLAttributes, useId, useState } from "react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  helperText?: string;
  error?: string;
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
      <path
        d="M2 10s2.7-5 8-5 8 5 8 5-2.7 5-8 5-8-5-8-5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      {crossed && <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  );
}

export function PasswordInput({ label, helperText, error, id, className = "", ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const message = error ?? helperText;
  const helperId = message ? `${inputId}-helper` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-body font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          type={visible ? "text" : "password"}
          aria-describedby={helperId}
          aria-invalid={Boolean(error) || undefined}
          className={`h-11 w-full rounded-xs border px-3 pr-11 text-body text-ink outline-none transition-colors duration-150 focus-visible:ring-2 ${
            error
              ? "border-rust focus-visible:border-rust focus-visible:ring-rust"
              : "border-line hover:border-line-strong focus-visible:border-brick focus-visible:ring-brick"
          } ${className}`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ink-muted hover:text-ink"
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>
      {message && (
        <p id={helperId} className={`text-caption ${error ? "text-rust" : "text-ink-muted"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
