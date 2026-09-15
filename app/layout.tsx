import type { Metadata } from "next";
import { AppProviders } from "@/components/providers/AppProviders";
import { siteConfig } from "@/lib/site-config";
import "./globals.css";

// Font stacks (--font-ui, --font-editorial) are defined in globals.css as
// plain CSS custom properties rather than loaded via next/font/google, so
// production never makes a request to a third-party font host. See the
// comment there for how to swap in licensed, self-hosted faces later.

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteConfig.url,
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
  },
};

// Deliberately no <SiteHeader>/<SiteFooter> here. Marketing, auth, and
// onboarding each need different chrome (full nav vs. a bare logo), so
// each route group supplies its own layout. This file only owns the
// document shell, global styles, and the mock session provider.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
