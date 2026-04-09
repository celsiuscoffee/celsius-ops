import type { NextConfig } from "next";

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

export default nextConfig;
