import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import {
  MapPin,
  ChevronRight,
  ShoppingBag,
  UtensilsCrossed,
} from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { useApp } from "@/lib/store";
import {
  ORDER_TYPE_LABEL,
  ORDER_TYPE_TAGLINE,
  resolveOrderType,
  type OrderType,
} from "@/lib/order-type";

/**
 * Takeaway | Dine-In selector + context summary — the McDonald's "Confirm
 * Order" header, shared by the cart and checkout screens.
 *
 *  - Takeaway: collect at the counter; pick/Change any outlet; no table.
 *  - Dine-In:  outlet + table locked to the scanned QR; served to the table.
 *
 * Tapping Dine-In with no table yet opens the scanner (the customer scans /
 * types their table, which sets dine-in on success). Switching never clears
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
      {/* Segmented toggle */}
      <View
        style={{
          flexDirection: "row",
          backgroundColor: "#F1ECE8",
          borderRadius: 14,
          padding: 4,
        }}
      >
        {(["pickup", "dine_in"] as OrderType[]).map((t) => {
          const active = current === t;
          const Icon = t === "pickup" ? ShoppingBag : UtensilsCrossed;
          return (
            <Pressable
              key={t}
              onPress={() => select(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 9,
                borderRadius: 11,
                backgroundColor: active ? "#FFFFFF" : "transparent",
                shadowColor: "#000",
                shadowOpacity: active ? 0.08 : 0,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon
                  size={15}
                  color={active ? "#A2492C" : "#8E8E93"}
                  strokeWidth={2.2}
                />
                <Text
                  style={{
                    fontFamily: "Peachi-Bold",
                    fontSize: 14,
                    color: active ? "#160800" : "#8E8E93",
                  }}
                >
                  {ORDER_TYPE_LABEL[t]}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 10,
                  color: active ? "#A2492C" : "#B0AAA4",
                  marginTop: 2,
                }}
              >
                {ORDER_TYPE_TAGLINE[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>

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
            backgroundColor: "#FBEBE8",
            borderWidth: 1,
            borderColor: "rgba(162,73,44,0.2)",
          }}
        >
          <UtensilsCrossed size={16} color="#A2492C" />
          <Text
            style={{ flex: 1, fontFamily: "Peachi-Bold", fontSize: 13.5, color: "#5A1F16" }}
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
