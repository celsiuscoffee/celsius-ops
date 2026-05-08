import { View, Text, Pressable, ScrollView } from "react-native";
import { Stack, router } from "expo-router";
import { ChevronRight, HelpCircle, Shield, Trash2 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { EspressoHeader } from "../components/EspressoHeader";

/**
 * Settings sub-screen.
 *
 * Pulled out of the main /account screen because the wall of action
 * rows there (My orders, Support, Privacy, Delete) made the
 * signed-in profile page feel busy and admin-like — a profile is
 * supposed to feel like the customer's space, not a settings panel.
 *
 * The high-frequency rows stay on /account (orders + sign out).
 * Lower-frequency / scary rows (Support, Privacy, Delete) live here
 * one tap deeper.
 */
export default function Settings() {
  const rows: Array<{
    icon: typeof HelpCircle;
    label: string;
    sub?: string;
    href: string;
    destructive?: boolean;
  }> = [
    {
      icon: HelpCircle,
      label: "Support",
      sub: "WhatsApp us, FAQ, contact",
      href: "/support",
    },
    {
      icon: Shield,
      label: "Privacy policy",
      sub: "What we store and why",
      href: "/privacy",
    },
    {
      icon: Trash2,
      label: "Delete account",
      sub: "Wipe all my data",
      href: "/account-delete",
      destructive: true,
    },
  ];

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Settings" showBack showCart={false} />

      <ScrollView contentContainerClassName="px-4 py-3">
        {rows.map((r, i) => {
          const Icon = r.icon;
          return (
            <Pressable
              key={r.label}
              onPress={() => {
                Haptics.selectionAsync();
                router.push(r.href as never);
              }}
              hitSlop={12}
              className="flex-row items-center gap-3 active:opacity-70"
              style={{
                paddingVertical: 14,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: "rgba(26, 2, 0, 0.08)",
              }}
              accessibilityRole="button"
              accessibilityLabel={r.label}
            >
              <View
                className="items-center justify-center"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: r.destructive ? "#FEE2E2" : "#FBEBE8",
                }}
              >
                <Icon size={16} color={r.destructive ? "#B91C1C" : "#C05040"} strokeWidth={2} />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[15px]"
                  style={{
                    fontFamily: "SpaceGrotesk_600SemiBold",
                    color: r.destructive ? "#B91C1C" : "#1A0200",
                  }}
                >
                  {r.label}
                </Text>
                {r.sub && (
                  <Text
                    className="text-[12px] mt-0.5"
                    style={{
                      fontFamily: "SpaceGrotesk_400Regular",
                      color: r.destructive ? "rgba(185, 28, 28, 0.65)" : "rgba(26, 2, 0, 0.55)",
                    }}
                  >
                    {r.sub}
                  </Text>
                )}
              </View>
              <ChevronRight size={16} color={r.destructive ? "#B91C1C" : "#8E8E93"} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
