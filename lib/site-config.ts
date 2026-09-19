export const siteConfig = {
  name: "RENKO",
  tagline: "Find the one SEO change worth making next.",
  description:
    "RENKO connects to Google Search Console and surfaces the single highest-value SEO change worth making next — with the evidence behind it.",
  // Production URL (sitemap, robots, metadata). Must match the deployed
  // frontend origin.
  url: "https://www.renkoo.online",
} as const;

export const primaryNav = [
  { label: "Product", href: "/#product" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Pricing", href: "/pricing" },
] as const;

export const footerNav = {
  product: [
    { label: "Product", href: "/#product" },
    { label: "Pricing", href: "/pricing" },
    { label: "How it works", href: "/#how-it-works" },
  ],
  account: [
    { label: "Sign in", href: "/log-in" },
    { label: "Connect Search Console", href: "/sign-up" },
  ],
  legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Contact", href: "/contact" },
  ],
} as const;
