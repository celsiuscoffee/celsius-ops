import { useEffect } from "react";
import { View } from "react-native";
import { Tabs } from "expo-router";
import {
  ClipboardCheck,
  ClipboardList,
  Clock,
  Home,
  Package,
  TrendingUp,
} from "lucide-react-native";
import { useStaff } from "../../lib/store";
import { hasAccess } from "../../lib/access";
import { refreshSession } from "../../lib/me";

const TAB_DEFS = [
  { name: "home",        title: "Home",       icon: Home,           moduleKey: "ops" },
  { name: "sales",       title: "Sales",      icon: TrendingUp,     moduleKey: "sales" },
  { name: "checklists",  title: "Checklists", icon: ClipboardCheck, moduleKey: "ops:checklists" },
  { name: "audit",       title: "Audit",      icon: ClipboardList,  moduleKey: "ops:audit" },
  { name: "hr",          title: "HR",         icon: Clock,          moduleKey: "hr" },
  { name: "inventory",   title: "Inventory",  icon: Package,        moduleKey: "inventory" },
] as const;

export default function StaffLayout() {
  const session = useStaff((s) => s.session);

  // Heal sessions saved before Phase 5b (no moduleAccess) — fetch fresh
  // from /api/auth/me and persist so the bottom bar gates correctly.
  useEffect(() => {
    if (session && session.moduleAccess == null) {
      refreshSession().catch(() => {});
    }
  }, [session]);

  const allowed = (key: string) =>
    hasAccess(session?.role, session?.moduleAccess, key);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Brand-dark tab bar — stays dark in both light AND dark modes
        // since it's brand chrome. Uses the v2026 anchor #160800.
        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "rgba(255, 255, 255, 0.45)",
        tabBarStyle: {
          backgroundColor: "#160800",
          borderTopColor: "rgba(255, 255, 255, 0.08)",
          paddingTop: 4,
          height: 84,
        },
        tabBarLabelStyle: {
          fontFamily: "SpaceGrotesk_600SemiBold",
          fontSize: 11,
        },
      }}
    >
      {TAB_DEFS.map((t) => {
        const Icon = t.icon;
        return (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarIcon: ({ color, size, focused }) => (
                <View
                  style={{
                    width: 48,
                    height: 32,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 16,
                    backgroundColor: focused
                      ? "rgba(255, 255, 255, 0.12)"
                      : "transparent",
                  }}
                >
                  <Icon color={color} size={size} />
                </View>
              ),
              href: allowed(t.moduleKey) ? undefined : null,
            }}
          />
        );
      })}

      {/* Hidden routes — reached via Home cards, HR landing, profile button, or notifications. */}
      <Tabs.Screen name="clock"        options={{ href: null }} />
      <Tabs.Screen name="claims"       options={{ href: null }} />
      <Tabs.Screen name="profile"      options={{ href: null }} />
      <Tabs.Screen name="personal"     options={{ href: null }} />
      <Tabs.Screen name="stock-count"  options={{ href: null }} />
      <Tabs.Screen name="wastage"      options={{ href: null }} />
      <Tabs.Screen name="receiving"    options={{ href: null }} />
      <Tabs.Screen name="transfers"    options={{ href: null }} />
      {/* Phase 8 procurement modules — reached from Inventory hub. */}
      <Tabs.Screen name="orders"       options={{ href: null }} />
      <Tabs.Screen name="invoices"     options={{ href: null }} />
    </Tabs>
  );
}
