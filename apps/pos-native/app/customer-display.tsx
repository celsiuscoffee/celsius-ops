import { View, Text, Image, FlatList } from "react-native";
import { useCart, cartSubtotal } from "@/lib/cart";
import { useDisplay } from "@/lib/display";
import { usePos } from "@/lib/store";

/**
 * Customer-facing second screen (SUNMI D3 secondary display, 1280×800
 * landscape). Reads the SAME in-process stores the register writes, so
 * it mirrors the cart instantly with zero network hop.
 *
 * Hosted on the physical second display by the native Presentation
 * module (see the dual-display native task). Also usable standalone as
 * a route for design preview.
 */
const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

const OUTLET_LABEL: Record<string, string> = {
  "outlet-sa": "Shah Alam",
  "outlet-con": "Putrajaya",
  "outlet-tam": "Tamarind",
  "outlet-nilai": "Nilai",
};

export default function CustomerDisplay() {
  const lines = useCart((s) => s.lines);
  const status = useDisplay((s) => s.status);
  const member = useDisplay((s) => s.member);
  const outletId = usePos((s) => s.outletId);

  const subtotal = cartSubtotal(lines);
  const hasCart = lines.length > 0;

  // Idle: no cart, not mid-payment → welcome screen.
  if (!hasCart && status !== "payment" && status !== "complete") {
    return (
      <View className="flex-1 bg-espresso items-center justify-center">
        <View className="h-28 w-28 rounded-3xl bg-cream items-center justify-center mb-6">
          <Text className="text-espresso text-6xl" style={{ fontFamily: "Peachi-Bold" }}>°C</Text>
        </View>
        <Text className="text-cream text-5xl" style={{ fontFamily: "Peachi-Bold" }}>Welcome to Celsius</Text>
        <Text className="text-cream/50 text-lg mt-3 tracking-[2px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
          {OUTLET_LABEL[outletId ?? ""] ?? "Celsius Coffee"}
        </Text>
      </View>
    );
  }

  // Ordering: live cart mirror.
  return (
    <View className="flex-1 bg-espresso flex-row">
      {/* Left: order */}
      <View className="flex-1 p-10">
        <View className="flex-row items-center gap-3 mb-8">
          <View className="h-12 w-12 rounded-2xl bg-cream items-center justify-center">
            <Text className="text-espresso text-2xl" style={{ fontFamily: "Peachi-Bold" }}>°C</Text>
          </View>
          <View>
            <Text className="text-cream text-2xl" style={{ fontFamily: "Peachi-Bold" }}>Your Order</Text>
            <Text className="text-cream/45 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
              {OUTLET_LABEL[outletId ?? ""] ?? "Celsius Coffee"}
            </Text>
          </View>
        </View>

        <FlatList
          data={lines}
          keyExtractor={(l) => l.key}
          renderItem={({ item }) => (
            <View className="flex-row items-center py-4 border-b border-border">
              <Text className="text-cream/60 text-2xl w-14" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                {item.qty}×
              </Text>
              <View className="flex-1">
                <Text className="text-cream text-2xl" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={1}>
                  {item.product.name}
                </Text>
                {item.modifiers.length > 0 && (
                  <Text className="text-cream/45 text-base" style={{ fontFamily: "SpaceGrotesk_400Regular" }} numberOfLines={1}>
                    {item.modifiers.map((m) => m.name).join(", ")}
                  </Text>
                )}
              </View>
              <Text className="text-cream text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                {rm(item.unit_sen * item.qty)}
              </Text>
            </View>
          )}
        />

        {/* Total */}
        <View className="border-t-2 border-cream/15 pt-5 mt-2 flex-row justify-between items-baseline">
          <Text className="text-cream text-3xl" style={{ fontFamily: "Peachi-Bold" }}>Total</Text>
          <Text className="text-amber-400 text-5xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(subtotal)}</Text>
        </View>
      </View>

      {/* Right: member / brand panel */}
      <View className="w-[420px] bg-surface border-l border-border p-10 justify-center">
        {member ? (
          <View>
            <Text className="text-cream/50 text-sm tracking-[2px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
              HI, {(member.name ?? "MEMBER").toUpperCase()}
            </Text>
            <Text className="text-cream text-3xl mt-2" style={{ fontFamily: "Peachi-Bold" }}>Member</Text>
            <View className="mt-6 rounded-3xl bg-amber-400/10 border border-amber-400/30 p-6">
              <Text className="text-amber-400 text-5xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                {member.pointsBalance.toLocaleString()}
              </Text>
              <Text className="text-amber-400/70 text-sm tracking-[2px] mt-1" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                BEANS
              </Text>
            </View>
          </View>
        ) : (
          <View className="items-center">
            <Text className="text-cream/60 text-2xl text-center" style={{ fontFamily: "Peachi-Medium" }}>
              Member?
            </Text>
            <Text className="text-cream/40 text-base text-center mt-2" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
              Tap your phone or give your number to earn Beans
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
