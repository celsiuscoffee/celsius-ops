import { View, Text, Pressable } from "react-native";
import { router, usePathname } from "expo-router";
import { Home, ClipboardList, Gift, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { CelsiusCup } from "./brand/CelsiusCup";
import { useApp } from "../lib/store";
import { fetchMyVouchers, fetchClaimableVouchers } from "../lib/rewards-v2";
import { fetchRewards, type Reward } from "../lib/rewards";

type Tab = {
  key: string;
  label: string;
  href: string;
  /** Lucide icon component, or null for tabs that render their own
   *  custom mark (e.g. Menu, which uses the Celsius cup logo). */
  icon: any | null;
  matches: (path: string) => boolean;
};

const TABS: Tab[] = [
  { key: "home", label: "Home", href: "/", icon: Home, matches: (p) => p === "/" },
  { key: "menu", label: "Menu", href: "/menu", icon: null, matches: (p) => p.startsWith("/menu") || p.startsWith("/product") },
  { key: "orders", label: "Orders", href: "/orders", icon: ClipboardList, matches: (p) => p.startsWith("/orders") || p.startsWith("/order/") },
  { key: "rewards", label: "Rewards", href: "/rewards", icon: Gift, matches: (p) => p === "/rewards" },
  { key: "account", label: "Account", href: "/account", icon: User, matches: (p) => p === "/account" },
];

export function BottomNav() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  // Live count of redeemable rewards — drives the badge over the Gift
  // icon. Same definition as the home-hero "Rewards" KPI so the two
  // numbers always match. Reads through React Query so each fetch
  // is cached across the app (no duplicate network).
  //   1. Active wallet vouchers (already owned)
  //   2. Claimables (welcome / promo / mystery_pending)
  //   3. Affordable points-shop catalog entries (under current Beans
  //                 balance, valid window, in stock, pickup-capable)
  const phone = useApp((s) => s.phone);
  const walletQ = useQuery({
    queryKey: ["my-vouchers", phone ?? "anon"],
    queryFn: fetchMyVouchers,
    enabled: !!phone,
    staleTime: 60_000,
  });
  const claimableQ = useQuery({
    queryKey: ["claimable-vouchers", phone ?? "anon"],
    queryFn: fetchClaimableVouchers,
    enabled: !!phone,
    staleTime: 60_000,
  });
  const rewardsCatalogQ = useQuery({
    queryKey: ["rewards", phone ?? "anonymous"],
    queryFn: () => fetchRewards(phone),
    enabled: !!phone,
    staleTime: 5 * 60_000,
  });

  const balance = rewardsCatalogQ.data?.pointsBalance ?? 0;
  const activeWalletCount = (walletQ.data ?? []).filter((v) => v.status === "active").length;
  const claimableCount = (claimableQ.data ?? []).length;
  const affordableCatalogCount = (rewardsCatalogQ.data?.rewards ?? []).filter((r: Reward) => {
    if (!r.is_active) return false;
    if (r.points_required <= 0 || r.points_required > balance) return false;
    const now = Date.now();
    if (r.valid_from && new Date(r.valid_from).getTime() > now) return false;
    if (r.valid_until && new Date(r.valid_until).getTime() < now) return false;
    if (r.stock != null && r.stock <= 0) return false;
    if (
      r.max_redemptions_per_member != null &&
      (r.redemption_count ?? 0) >= r.max_redemptions_per_member
    ) {
      return false;
    }
    const ft = r.fulfillment_type;
    if (Array.isArray(ft) && ft.length > 0 && !ft.includes("pickup")) return false;
    return true;
  }).length;
  const rewardsCount = activeWalletCount + claimableCount + affordableCatalogCount;

  return (
    <View
      className="absolute bottom-0 left-0 right-0 bg-surface border-t border-border flex-row justify-around px-1 pt-2"
      style={{
        paddingBottom: Math.max(insets.bottom, 8),
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: -1 },
      }}
    >
      {TABS.map((tab) => {
        const active = tab.matches(pathname);
        const Icon = tab.icon;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              Haptics.selectionAsync();
              if (active) return;
              // replace, not push — tab switches shouldn't accumulate
              // back-history. Each tab is a sibling, not a deeper level.
              router.replace(tab.href as any);
            }}
            className="flex-1 items-center gap-1 py-1.5 active:opacity-60"
            hitSlop={12}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${tab.label} tab`}
          >
            {Icon ? (
              <View>
                <Icon
                  size={26}
                  color={active ? "#160800" : "#8E8E93"}
                  strokeWidth={active ? 2.4 : 1.75}
                  fill={active ? "#160800" : "transparent"}
                  fillOpacity={active ? 0.08 : 0}
                />
                {/* Rewards-count badge. Anchored to the upper-right of
                    the Gift icon so the customer reads it as "you have
                    N things waiting" without crowding the label below.
                    Capped at 9+ so a long-tail wallet doesn't break
                    the bubble. Only shown when count > 0. */}
                {tab.key === "rewards" && rewardsCount > 0 ? (
                  <View
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -8,
                      minWidth: 16,
                      height: 16,
                      paddingHorizontal: 4,
                      borderRadius: 8,
                      backgroundColor: "#C05040",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1.5,
                      borderColor: "#FFFFFF",
                    }}
                    accessibilityElementsHidden
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontFamily: "SpaceGrotesk_700Bold",
                        fontSize: 9.5,
                        lineHeight: 11,
                      }}
                    >
                      {rewardsCount > 9 ? "9+" : rewardsCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              // Custom Menu mark — hand-authored Celsius cup with the
              // "C" wordmark baked in. The `active` prop mirrors the
              // lucide outline treatment used by every other tab:
              // thicker stroke + 8% body wash when selected, thin
              // stroke and no fill when inactive. So the menu icon
              // doesn't read as an outlier in the row.
              <CelsiusCup
                size={26}
                color={active ? "#160800" : "#8E8E93"}
                active={active}
              />
            )}
            <Text
              style={{
                // Space Grotesk reads cleaner than the system default at
                // small sizes, and a couple of points up makes the labels
                // legible without dominating the icon.
                fontFamily: active ? "SpaceGrotesk_700Bold" : "SpaceGrotesk_600SemiBold",
                fontSize: 12.5,
                letterSpacing: 0.2,
                color: active ? "#160800" : "#8E8E93",
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
