import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { MapPin, ChevronRight, UtensilsCrossed } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { useApp } from "@/lib/store";
import { resolveOrderType, type OrderType } from "@/lib/order-type";
import { OrderTypeToggle } from "./OrderTypeToggle";

/**
 * Home order-mode entry — the single place a customer chooses HOW to order,
 * so the old confusion (a Pickup outlet + a separate "scan your table" button
 * sitting side by side, pointing at different outlets) goes away.
 *
 *   Dine-In selected → scan a table → row shows "Table N · Outlet"
 *   Pickup  selected → pick an outlet (with open/busy + ETA) → "Change"
 *
 * Only ONE context shows at a time: scanning a table flips the whole card to
 * the dine-in row, so a Putrajaya pickup never sits next to a Shah Alam scan.
 */
export function HomeOrderMode({
  outletStatus,
}: {
  /** Pre-computed pickup-outlet status pill (open/busy + ETA). */
  outletStatus?: { color: string; label: string } | null;
}) {
  const orderType = useApp((s) => s.orderType);
  const tableNumber = useApp((s) => s.tableNumber);
  const outletName = useApp((s) => s.outletName);
  const setOrderType = useApp((s) => s.setOrderType);
  const current = resolveOrderType(orderType);

  const select = (next: OrderType) => {
    if (next === current) return;
    Haptics.selectionAsync();
    if (next === "dine_in" && !tableNumber) {
      // No table yet — scan one; the scanner flips us into dine-in on success.
      router.push("/scan" as never);
      return;
    }
    setOrderType(next, next === "dine_in" ? tableNumber ?? undefined : undefined);
  };

  return (
    <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 2, gap: 10 }}>
      <OrderTypeToggle value={current} onSelect={select} />

      {current === "dine_in" ? (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/menu");
          }}
          accessibilityRole="button"
          accessibilityLabel={`Dine-in${tableNumber ? `, table ${tableNumber}` : ""}${
            outletName ? ` at ${outletName}` : ""
          }`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: "#FBEBE8",
            borderWidth: 1,
            borderColor: "rgba(162,73,44,0.2)",
          }}
        >
          <UtensilsCrossed size={16} color="#A2492C" />
          <Text
            style={{ flex: 1, fontFamily: "Peachi-Bold", fontSize: 14, color: "#5A1F16" }}
            numberOfLines={1}
          >
            {tableNumber ? `Table ${tableNumber}` : "Dine-in"}
            {outletName ? ` · ${outletName}` : ""}
          </Text>
          <ChevronRight size={15} color="#A2492C" />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/store");
          }}
          accessibilityRole="button"
          accessibilityLabel={`Pickup outlet: ${outletName ?? "not selected"}. Tap to change.`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: "#F7F4F2",
            borderWidth: 1,
            borderColor: "#ECE5E0",
          }}
        >
          <MapPin size={16} color="#8E8E93" />
          <Text
            style={{ flex: 1, fontFamily: "Peachi-Bold", fontSize: 14, color: "#160800" }}
            numberOfLines={1}
          >
            {outletName ?? "Select pickup outlet"}
          </Text>
          {outletStatus && (
            <>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 3.5,
                  backgroundColor: outletStatus.color,
                }}
              />
              <Text
                style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "#8E8E93" }}
              >
                {outletStatus.label}
              </Text>
            </>
          )}
          <ChevronRight size={15} color="#8E8E93" />
        </Pressable>
      )}
    </View>
  );
}
