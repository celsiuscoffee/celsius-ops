import { useEffect } from "react";
import { View } from "react-native";
import { Redirect, Tabs } from "expo-router";
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
  const isAdmin = session?.role === "OWNER" || session?.role === "ADMIN";
  // Sales is a manager-and-up concern (revenue, payment mix, growth). Owners and
  // admins get it as their Home tab (relabelled below); managers get the
  // standalone Sales tab. Plain STAFF never see Sales, even if an access preset
  // happens to grant them the "sales" module.
  const isManagerPlus = isAdmin || session?.role === "MANAGER";

  // Refresh moduleAccess + outletId from /api/auth/me on every launch so
  // access-preset changes and outlet assignments propagate WITHOUT a forced
  // re-login (previously this only ran when moduleAccess was entirely missing,
  // so a staff member granted a new module never saw it until they signed out).
  useEffect(() => {
    refreshSession().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allowed = (key: string) =>
    hasAccess(session?.role, session?.moduleAccess, key);

  // Session died (12h JWT expiry / 401 wipe in lib/api.ts / remote logout):
  // route to login instead of stranding the user on a dead screen with no
  // tabs. The root layout gates rendering on sessionHydrated, so by the time
  // this runs a null session is authoritative, not a not-yet-loaded one.
  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Brand-dark tab bar, stays dark in both light AND dark modes
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
        // Owners' Home tab IS the Sales dashboard → relabel it "Sales" and
        // hide the now-duplicate standalone Sales tab.
        const isHomeAsSales = isAdmin && t.name === "home";
        const Icon = isHomeAsSales ? TrendingUp : t.icon;
        return (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: isHomeAsSales ? "Sales" : t.title,
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
              href:
                (t.name === "sales" && (isAdmin || !isManagerPlus)) ||
                !allowed(t.moduleKey)
                  ? null
                  : undefined,
            }}
          />
        );
      })}

      {/* Hidden routes, reached via Home cards, HR landing, profile button, or notifications. */}
      <Tabs.Screen name="clock"        options={{ href: null }} />
      <Tabs.Screen name="claims"       options={{ href: null }} />
      <Tabs.Screen name="profile"      options={{ href: null }} />
      <Tabs.Screen name="personal"     options={{ href: null }} />
      <Tabs.Screen name="stock-count"  options={{ href: null }} />
      <Tabs.Screen name="wastage"      options={{ href: null }} />
      <Tabs.Screen name="receiving"    options={{ href: null }} />
      <Tabs.Screen name="transfers"    options={{ href: null }} />
      {/* Phase 8 procurement modules, reached from Inventory hub. */}
      <Tabs.Screen name="orders"       options={{ href: null }} />
      <Tabs.Screen name="invoices"     options={{ href: null }} />
    </Tabs>
  );
}
