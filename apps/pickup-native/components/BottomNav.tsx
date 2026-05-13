import { View, Text, Pressable } from "react-native";
import { router, usePathname } from "expo-router";
import { Home, ClipboardList, Gift, User } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { CelsiusCup } from "./brand/CelsiusCup";

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
              <Icon
                size={26}
                color={active ? "#160800" : "#8E8E93"}
                strokeWidth={active ? 2.4 : 1.75}
                fill={active ? "#160800" : "transparent"}
                fillOpacity={active ? 0.08 : 0}
              />
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
