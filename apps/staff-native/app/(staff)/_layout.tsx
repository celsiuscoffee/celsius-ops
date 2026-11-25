import { useEffect } from "react";
import { View } from "react-native";
import { Redirect, Tabs } from "expo-router";
import {
  ClipboardCheck,
  Home,
  Package,
  TrendingUp,
  UserRound,
} from "lucide-react-native";
import { useStaff } from "../../lib/store";
import { hasAccess } from "../../lib/access";
import { refreshSession } from "../../lib/me";
import { useCelsius } from "../../lib/celsius-ui";

// Five tabs at most, one per job (docs/design/staff-native-structure.md):
//   Today  — clock in, today's tasks (owners: the Sales dashboard)
//   Sales  — managers' revenue view (owners already have it as Today)
//   Checks — checklists, with audits inside it
//   Stock  — every stock and purchasing job
//   Me     — shifts, leave, pay, scoreboard, profile and settings
const TAB_DEFS = [
  { name: "home",       title: "Today",  icon: Home,           moduleKey: "ops" },
  { name: "sales",      title: "Sales",  icon: TrendingUp,     moduleKey: "sales" },
  { name: "checklists", title: "Checks", icon: ClipboardCheck, moduleKey: "ops:checklists" },
  { name: "audit",      title: "Checks", icon: ClipboardCheck, moduleKey: "ops:audit" },
  { name: "inventory",  title: "Stock",  icon: Package,        moduleKey: "inventory" },
  { name: "hr",         title: "Me",     icon: UserRound,      moduleKey: "hr" },
] as const;

export default function StaffLayout() {
  const C = useCelsius().color;
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

  // Audits live inside Checks (a row on the checklists screen). The audit
  // route only takes the tab when the person can audit but has no checklists.
  const hidden = (name: string, moduleKey: string) => {
    if (!allowed(moduleKey)) return true;
    if (name === "sales") return isAdmin || !isManagerPlus;
    if (name === "audit") return allowed("ops:checklists");
    return false;
  };

  return (
    <Tabs
      // Back from a screen opened from another tab returns to that tab, not
      // to Today.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.text,
        tabBarInactiveTintColor: C["text-3"],
        tabBarStyle: {
          backgroundColor: C.tab,
          borderTopColor: C.line,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: "SpaceGrotesk_600SemiBold",
          fontSize: 12,
        },
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      {TAB_DEFS.map((t) => {
        // Owners' Home tab IS the Sales dashboard → relabel it "Sales".
        const isHomeAsSales = isAdmin && t.name === "home";
        const Icon = isHomeAsSales ? TrendingUp : t.icon;
        return (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: isHomeAsSales ? "Sales" : t.title,
              tabBarIcon: ({ color, focused }) => (
                <View
                  style={{
                    width: 52,
                    height: 30,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 15,
                    backgroundColor: focused ? C.sunken : "transparent",
                  }}
                >
                  <Icon color={color} size={22} />
                </View>
              ),
              href: hidden(t.name, t.moduleKey) ? null : undefined,
            }}
          />
        );
      })}

      {/* Inner routes without a tab, reached from Today, Stock, Me or a notification. */}
      <Tabs.Screen name="clock"        options={{ href: null }} />
      <Tabs.Screen name="claims"       options={{ href: null }} />
      <Tabs.Screen name="profile"      options={{ href: null }} />
      <Tabs.Screen name="personal"     options={{ href: null }} />
      <Tabs.Screen name="stock-count"  options={{ href: null }} />
      <Tabs.Screen name="wastage"      options={{ href: null }} />
      <Tabs.Screen name="receiving"    options={{ href: null }} />
      <Tabs.Screen name="transfers"    options={{ href: null }} />
      <Tabs.Screen name="orders"       options={{ href: null }} />
      <Tabs.Screen name="invoices"     options={{ href: null }} />
    </Tabs>
  );
}
