import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { MapPin, ChevronRight, UtensilsCrossed } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { useApp } from "@/lib/store";
import { resolveOrderType, type OrderType } from "@/lib/order-type";
import { OrderTypeToggle } from "./OrderTypeToggle";

/**
 * Dine-In | Pickup selector + context summary — the McDonald's "Confirm
 * Order" header, shared by the cart and checkout screens.
 *
 *  - Pickup:  collect at the counter; pick/Change any outlet; no table.
 *  - Dine-In: outlet + table locked to the scanned QR; served to the table.
 *
 * Tapping Dine-In with no table yet opens the scanner. Switching never clears
 * the cart — store.setOrderType preserves it; the applied reward is
 * re-validated by the checkout validity panel.
 */
export function OrderTypeBar() {
  const orderType = useApp((s) => s.orderType);
  const tableNumber = useApp((s) => s.tableNumber);
  const outletName = useApp((s) => s.outletName);
  const setOrderType = useApp((s) => s.setOrderType);
  const current = resolveOrderType(orderType);

  const select = (next: OrderType) => {
    if (next === current) return;
    Haptics.selectionAsync();
    if (next === "dine_in" && !tableNumber) {
      // No table yet — send them to scan/enter one; the scanner calls
      // setDineIn on a successful read, which flips us into dine-in.
      router.push("/scan" as never);
      return;
    }
    setOrderType(next, next === "dine_in" ? tableNumber ?? undefined : undefined);
  };

  return (
    <View style={{ gap: 10 }}>
      <OrderTypeToggle value={current} onSelect={select} />

      {/* Context summary */}
      {current === "dine_in" ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 11,
            borderRadius: 12,
            backgroundColor: "#F7F4F2",
            borderWidth: 1,
            borderColor: "#ECE5E0",
          }}
        >
          <UtensilsCrossed size={16} color="#8E8E93" />
          <Text
            style={{ flex: 1, fontFamily: "Peachi-Bold", fontSize: 13.5, color: "#160800" }}
            numberOfLines={1}
          >
            {tableNumber ? `Table ${tableNumber}` : "Dine-in"}
            {outletName ? ` · ${outletName}` : ""}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/store");
          }}
          accessibilityRole="button"
          accessibilityLabel="Change pickup outlet"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 11,
            borderRadius: 12,
            backgroundColor: "#F7F4F2",
            borderWidth: 1,
            borderColor: "#ECE5E0",
          }}
        >
          <MapPin size={16} color="#8E8E93" />
          <Text
            style={{ flex: 1, fontFamily: "Peachi-Bold", fontSize: 13.5, color: "#160800" }}
            numberOfLines={1}
          >
            {outletName ? `Pickup at ${outletName}` : "Select pickup outlet"}
          </Text>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, color: "#A2492C" }}>
            Change
          </Text>
          <ChevronRight size={14} color="#A2492C" />
        </Pressable>
      )}
    </View>
  );
}
