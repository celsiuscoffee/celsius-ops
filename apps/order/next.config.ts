import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    imageSizes: [64, 88, 128, 176, 256],
    deviceSizes: [375, 430, 768, 1080],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "kqdcdhpnyuwrxqhbuyfl.supabase.co",
      },
      {
        // Cloudinary CDN — 300+ edge locations worldwide
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
};

// Sentry's build-time plugin (source-map generation + upload, release creation,
// monitor setup) is a major contributor to build CPU. It's only useful for the
// Production deployment, so skip it entirely on Preview/local builds — those
// don't need uploaded source maps or Vercel cron monitors.
export default process.env.VERCEL_ENV === "production"
  ? withSentryConfig(nextConfig, {
      org: "celsius-coffee-sdn-bhd",
      project: "celsius-ops",
      silent: !process.env.CI,
      disableLogger: true,
      automaticVercelMonitors: true,
    })
  : nextConfig;
