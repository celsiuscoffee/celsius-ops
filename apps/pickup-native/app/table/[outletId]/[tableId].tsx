import { useEffect, useRef } from "react";
import { View, Text, ActivityIndicator } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useApp } from "@/lib/store";
import { supabase } from "@/lib/supabase";

/**
 * Table-QR deep-link landing.
 *
 * The in-store table QR encodes
 * https://order.celsiuscoffee.com/table/{outletId}/{tableId}. When the
 * native app is installed, iOS Universal Links / Android App Links open it
 * straight to this route; otherwise the PWA handles the same URL in the
 * browser. We pin the outlet, flag the order dine_in + tableNumber, start a
 * clean basket, then replace into the menu — mirroring the PWA's
 * apps/order/src/app/table/[outletId]/[tableId]/_TableEntry.tsx so both
 * surfaces behave identically.
 *
 * orderType / tableNumber are NOT persisted (see store partialize): this
 * route re-establishes them on every scan, and a killed-then-reopened app
 * defaults back to pickup so nobody is stranded in "dine-in Table N".
 */
export default function TableEntry() {
  const params = useLocalSearchParams<{ outletId?: string; tableId?: string }>();
  const setDineIn = useApp((s) => s.setDineIn);
  const setOutlet = useApp((s) => s.setOutlet);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    const outletId = Array.isArray(params.outletId) ? params.outletId[0] : params.outletId;
    const tableId = Array.isArray(params.tableId) ? params.tableId[0] : params.tableId;
    if (!outletId || !tableId) {
      // Malformed link — fall back to the normal flow rather than trapping
      // the customer on a spinner.
      router.replace("/store");
      return;
    }
    handled.current = true;

    // Set the dine-in context immediately (empty name) and head to the menu
    // without waiting on the network — the menu/checkout resolve the full
    // outlet from the id anyway.
    setDineIn(outletId, "", tableId);
    router.replace("/menu");

    // Best-effort: fill in the outlet name in the background. setOutlet only
    // touches id + name, so it won't disturb a cart the customer starts
    // building on the menu.
    (async () => {
      try {
        const { data } = await supabase
          .from("outlets")
          .select("name")
          .eq("store_id", outletId)
          .maybeSingle();
        const name = (data as { name?: string } | null)?.name;
        if (name) setOutlet(outletId, name);
      } catch {
        // Name is cosmetic — the menu works with the id alone.
      }
    })();
  }, [params.outletId, params.tableId, setDineIn, setOutlet]);

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#160800",
        gap: 16,
      }}
    >
      <ActivityIndicator color="#FFFFFF" />
      <Text style={{ color: "#FFFFFF", fontFamily: "Peachi-Medium", fontSize: 16 }}>
        Setting up your table…
      </Text>
    </View>
  );
}
