"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";

const PAGE_LABELS: Record<string, string> = {
  favourites:    "Favourites",
  vouchers:      "Vouchers & Promos",
  outlets:       "Saved Outlets",
  notifications: "Notifications",
  settings:      "Settings",
  help:          "Help & FAQ",
  privacy:       "Privacy Policy",
};

export default function ComingSoonPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const router       = useRouter();
  const { slug }     = use(params);
  const key          = slug?.[0] ?? "";
  const label        = PAGE_LABELS[key] ?? "This page";

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      <header className="bg-white px-4 pt-12 pb-3 flex items-center gap-3 sticky top-0 z-10 border-b">
        <button onClick={() => router.back()} className="p-1">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold flex-1 text-center">{label}</h1>
        <div className="w-7" />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center pb-24">
        <div className="w-16 h-16 rounded-2xl bg-[#160800]/8 flex items-center justify-center mb-4">
          <Clock className="h-8 w-8 text-[#160800]/40" strokeWidth={1.5} />
        </div>
        <h2 className="text-lg font-bold text-[#160800] mb-1">Coming Soon</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          {label} is being built and will be available in a future update.
        </p>
        <button
          onClick={() => router.back()}
          className="mt-6 bg-[#160800] text-white rounded-full px-6 py-3 text-sm font-semibold"
        >
          Go Back
        </button>
      </main>

      <BottomNav />
    </div>
  );
}
