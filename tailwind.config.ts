import type { Config } from "tailwindcss";

// This file is the single source of truth for RENKO's visual tokens.
// Values are copied 1:1 from the approved RENKO Design System (Phase 1).
// Do not add colors, radii, or shadows here without updating that document first.

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FAFAF8",
        surface: {
          DEFAULT: "#FFFFFF",
          sunken: "#F1F0EB",
        },
        ink: {
          DEFAULT: "#14171A",
          muted: "#5B616B",
        },
        line: {
          DEFAULT: "#E4E3DD",
          strong: "#CFCEC6",
        },
        brick: {
          DEFAULT: "#1F6E54",
          tint: "#E4EFE9",
          // hover/active shades derived from the approved accent, not new colors
          hover: "#195A44",
          active: "#134432",
        },
        amber: {
          DEFAULT: "#9A6B1E",
          tint: "#F6EDDD",
        },
        rust: {
          DEFAULT: "#A63B2E",
          tint: "#F5E4E0",
        },
      },
      fontFamily: {
        sans: ["var(--font-ui)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-editorial)", "ui-serif", "Georgia", "serif"],
      },
      fontSize: {
        // token: [font-size, { lineHeight, letterSpacing }]
        caption: ["12px", { lineHeight: "18px" }],
        body: ["14px", { lineHeight: "22px" }],
        "body-lg": ["16px", { lineHeight: "26px" }],
        h3: ["15px", { lineHeight: "22px" }],
        h2: ["18px", { lineHeight: "26px" }],
        h1: ["24px", { lineHeight: "32px" }],
        "metric-s": ["16px", { lineHeight: "22px" }],
        "metric-l": ["28px", { lineHeight: "32px" }],
        display: ["32px", { lineHeight: "40px" }],
        "editorial-h1": ["44px", { lineHeight: "50px", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        none: "0px",
        xs: "4px",
        sm: "8px",
        pill: "9999px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(20,23,26,0.06)",
        md: "0 4px 16px rgba(20,23,26,0.10)",
      },
      maxWidth: {
        content: "720px",
        editorial: "640px",
        page: "1120px",
      },
      transitionDuration: {
        150: "150ms",
        200: "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
