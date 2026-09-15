import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Marketing pages are fully static — no server data dependency in this phase.
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
