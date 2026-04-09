"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  User,
  ChevronRight,
  ClipboardList,
  Heart,
  MapPin,
  Bell,
  HelpCircle,
  Shield,
  LogIn,
  Settings,
  Tag,
  Star,
  LogOut,
} from "lucide-react";
import { BottomNav } from "@/components/bottom-nav";
import { useCartStore } from "@/store/cart";

const MENU_SECTIONS = [
  {
    title: "Orders",
    items: [
      { icon: ClipboardList, label: "Order History", href: "/account/orders" },
      { icon: Heart, label: "Favourites", href: "/account/favourites" },
      { icon: Tag, label: "Vouchers & Promos", href: "/account/vouchers" },
    ],
  },
  {
    title: "Preferences",
    items: [
      { icon: MapPin, label: "Saved Outlets", href: "/account/outlets" },
      { icon: Bell, label: "Notifications", href: "/account/notifications" },
      { icon: Settings, label: "Settings", href: "/account/settings" },
    ],
  },
  {
    title: "Support",
    items: [
      { icon: HelpCircle, label: "Help & FAQ", href: "/account/help" },
      { icon: Shield, label: "Privacy Policy", href: "/account/privacy" },
    ],
  },
];

export default function AccountPage() {
  const loyaltyMember = useCartStore((s) => s.loyaltyMember);
  const setLoyaltyMember = useCartStore((s) => s.setLoyaltyMember);
  const _hasHydrated = useCartStore((s) => s._hasHydrated);

  const isLoggedIn = _hasHydrated && !!loyaltyMember;

  // Refresh points from loyalty API on mount so account page always matches rewards page
  useEffect(() => {
    if (!loyaltyMember?.phone) return;
    fetch(`/api/loyalty/member?phone=${encodeURIComponent(loyaltyMember.phone)}`)
      .then((r) => r.json())
      .then(({ member }) => {
        if (member) setLoyaltyMember(member);
      })
      .catch(() => {/* silently ignore */});
  }, [loyaltyMember?.phone, setLoyaltyMember]);

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-[#160800] px-4 pt-12 pb-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-white text-lg font-bold">Account</h1>
          {isLoggedIn && (
            <button
              onClick={() => setLoyaltyMember(null)}
              className="flex items-center gap-1.5 text-white/60 text-xs"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          )}
        </div>

        {/* Guest / Profile card */}
        {isLoggedIn ? (
          <div className="space-y-3">
            {/* Profile row */}
            <div className="bg-white/10 rounded-2xl px-4 py-4 flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <User className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">
                  {loyaltyMember.name ?? "Celsius Member"}
                </p>
                <p className="text-white/60 text-xs mt-0.5 truncate">{loyaltyMember.phone}</p>
              </div>
            </div>
            {/* Points card */}
            <div className="bg-amber-500/20 rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-400/30 flex items-center justify-center shrink-0">
                <Star className="h-5 w-5 text-amber-300 fill-amber-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-amber-200 text-xs font-semibold uppercase tracking-wide">
                  Celsius Rewards
                </p>
                <p className="text-white font-black text-lg leading-tight">
                  {loyaltyMember.pointsBalance.toLocaleString()}
                  <span className="text-white/60 text-xs font-normal ml-1">pts</span>
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-white/60 text-[10px]">{loyaltyMember.totalVisits} visits</p>
                <p className="text-white/60 text-[10px]">{loyaltyMember.totalPointsEarned.toLocaleString()} earned</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white/10 rounded-2xl px-4 py-4 flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <User className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm">Guest</p>
              <p className="text-white/60 text-xs mt-0.5">Sign in to track orders & earn rewards</p>
            </div>
            <Link
              href="/account/login"
              className="flex items-center gap-1.5 bg-primary text-white text-xs font-semibold px-3 py-2 rounded-full shrink-0"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign In
            </Link>
          </div>
        )}
      </header>

      <main className="flex-1 px-4 py-4 space-y-4 pb-24">
        {MENU_SECTIONS.map((section) => (
          <section key={section.title}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
              {section.title}
            </p>
            <div className="bg-white rounded-2xl overflow-hidden">
              {section.items.map((item, i) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3.5 transition-colors active:bg-muted/50 ${
                      i < section.items.length - 1 ? "border-b border-border/50" : ""
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-[#160800]" strokeWidth={1.5} />
                    </div>
                    <span className="flex-1 text-sm font-medium">{item.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        {/* App version + Backoffice link */}
        <div className="text-center pt-2 space-y-2">
          <p className="text-xs text-muted-foreground">°Celsius Coffee · v1.0.0</p>
          <a
            href="https://backoffice.celsiuscoffee.com"
            className="inline-block text-[11px] text-muted-foreground/60 underline underline-offset-2"
          >
            Staff / Backoffice
          </a>
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
