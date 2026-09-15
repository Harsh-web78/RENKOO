/**
 * Single source of truth for raw token values needed outside Tailwind utility
 * classes (inline SVG fills, <meta theme-color>, canvas, etc).
 * Keep in sync with tailwind.config.ts — do not hardcode hex values elsewhere.
 */
export const colors = {
  paper: "#FAFAF8",
  surface: "#FFFFFF",
  surfaceSunken: "#F1F0EB",
  ink: "#14171A",
  inkMuted: "#5B616B",
  line: "#E4E3DD",
  lineStrong: "#CFCEC6",
  brick: "#1F6E54",
  brickTint: "#E4EFE9",
  brickHover: "#195A44",
  amber: "#9A6B1E",
  amberTint: "#F6EDDD",
  rust: "#A63B2E",
  rustTint: "#F5E4E0",
} as const;

export type ColorToken = keyof typeof colors;
