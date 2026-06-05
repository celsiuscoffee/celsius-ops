import { View, Text, Pressable } from "react-native";
import { ShoppingBag, UtensilsCrossed } from "lucide-react-native";
import { ORDER_TYPE_LABEL, type OrderType } from "@/lib/order-type";

/**
 * The Dine-In | Pickup segmented control — shared by the home entry
 * (HomeOrderMode) and the cart/checkout summary (OrderTypeBar) so every
 * surface uses the exact same toggle. Dine-In sits first by product choice.
 *
 * Compact single row (icon + label, no tagline) to keep the home light.
 * Purely presentational: the parent owns what "select" does.
 */
const SEGMENTS: OrderType[] = ["dine_in", "pickup"];

export function OrderTypeToggle({
  value,
  onSelect,
}: {
  value: OrderType;
  onSelect: (next: OrderType) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: "#F1ECE8",
        borderRadius: 14,
        padding: 4,
      }}
    >
      {SEGMENTS.map((t) => {
        const active = value === t;
        const Icon = t === "pickup" ? ShoppingBag : UtensilsCrossed;
        return (
          <Pressable
            key={t}
            onPress={() => onSelect(t)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 11,
              borderRadius: 11,
              backgroundColor: active ? "#FFFFFF" : "transparent",
              shadowColor: "#000",
              shadowOpacity: active ? 0.08 : 0,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
            }}
          >
            <Icon
              size={15}
              color={active ? "#160800" : "#8E8E93"}
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
          </Pressable>
        );
      })}
    </View>
  );
}
