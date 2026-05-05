import { View, Text, Pressable } from "react-native";
import { router, usePathname } from "expo-router";
import { Home, ClipboardList, Gift, User, BookOpen } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

type Tab = {
  key: string;
  label: string;
  href: string;
  icon: any;
  matches: (path: string) => boolean;
};

const TABS: Tab[] = [
  { key: "home", label: "Home", href: "/", icon: Home, matches: (p) => p === "/" },
  { key: "menu", label: "Menu", href: "/menu", icon: BookOpen, matches: (p) => p.startsWith("/menu") || p.startsWith("/product") },
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
            className="flex-1 items-center gap-1 py-1 active:opacity-60"
            hitSlop={8}
          >
            <Icon
              size={22}
              color={active ? "#160800" : "#8E8E93"}
              strokeWidth={active ? 2.4 : 1.75}
              fill={active ? "#160800" : "transparent"}
              fillOpacity={active ? 0.08 : 0}
            />
            <Text
              className={`text-[10px] ${active ? "text-espresso font-bold" : "text-muted-fg font-medium"}`}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
