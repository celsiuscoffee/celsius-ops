import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  experimental: {
    // Tree-shake heavy packages to reduce serverless function cold starts
    optimizePackageImports: [
      "lucide-react",
      "@supabase/supabase-js",
      "zod",
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
