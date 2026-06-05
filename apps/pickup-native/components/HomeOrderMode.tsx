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
 * pointing at different outlets) goes away.
 *
 *   Dine-In selected → scan a table → "Table N · Outlet"
 *   Pickup  selected → pick an outlet (with open/busy + ETA)
 *
 * Kept deliberately light: the toggle + ONE plain context line (no box, no
 * alert-red), only one context at a time. Scanning a table flips the whole
 * card to dine-in, so a Putrajaya pickup never sits next to a Shah Alam scan.
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
  const isDineIn = current === "dine_in";

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
    <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 2, gap: 9 }}>
      <OrderTypeToggle value={current} onSelect={select} />

      {/* Plain context line — no box, neutral. Pickup → change outlet;
          dine-in → straight to the menu for that table. */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push(isDineIn ? "/menu" : "/store");
        }}
        accessibilityRole="button"
        accessibilityLabel={
          isDineIn
            ? `Dine-in${tableNumber ? `, table ${tableNumber}` : ""}${
                outletName ? ` at ${outletName}` : ""
              }`
            : `Pickup outlet: ${outletName ?? "not selected"}. Tap to change.`
        }
        className="active:opacity-70"
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 7,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}
      >
        {isDineIn ? (
          <UtensilsCrossed size={15} color="#8E8E93" />
        ) : (
          <MapPin size={15} color="#8E8E93" />
        )}
        <Text
          style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#160800", flexShrink: 1 }}
          numberOfLines={1}
        >
          {isDineIn
            ? `${tableNumber ? `Table ${tableNumber}` : "Dine-in"}${
                outletName ? ` · ${outletName}` : ""
              }`
            : outletName ?? "Select pickup outlet"}
        </Text>
        {!isDineIn && outletStatus && (
          <>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: outletStatus.color,
                marginLeft: 2,
              }}
            />
            <Text
              style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "#8E8E93" }}
            >
              {outletStatus.label}
            </Text>
          </>
        )}
        <ChevronRight size={14} color="#8E8E93" />
      </Pressable>
    </View>
  );
}
