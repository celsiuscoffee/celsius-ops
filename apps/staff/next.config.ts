import type { NextConfig } from "next";

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

export default nextConfig;
