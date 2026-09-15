import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site-config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/sign-up", "/log-in", "/privacy", "/terms", "/contact"],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
