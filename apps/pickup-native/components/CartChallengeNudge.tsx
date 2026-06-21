import { View, Text } from "react-native";
import { Gift, Check } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { fetchCartChallenge } from "../lib/cart-challenge";

/**
 * AOV challenge nudge at the cart — "Spend RM12 more to unlock Free Coffee".
 * Surfaces the member's closest-to-complete single-order mission so a bigger
 * basket completes a reward now. Sits above the upsell rail (which suggests
 * what to add). Renders nothing when nothing's close.
 */
export function CartChallengeNudge({
  items,
  loyaltyId,
}: {
  items: { product_id: string; quantity: number; total_sen: number }[];
  loyaltyId: string | null;
}) {
  const key = items.map((i) => `${i.product_id}:${i.quantity}:${i.total_sen}`).sort().join("|");
  const { data } = useQuery({
    queryKey: ["cart-challenge", key, loyaltyId],
    queryFn: () => fetchCartChallenge(items, loyaltyId),
    enabled: !!loyaltyId && items.length > 0,
    staleTime: 30_000,
  });
  const c = data ?? null;
  if (!c) return null;

  return (
    <View className="px-4 mb-3">
      <View className="flex-row items-center bg-espresso" style={{ borderRadius: 14, padding: 11, gap: 10 }}>
        <View
          className="items-center justify-center rounded-full"
          style={{ width: 30, height: 30, backgroundColor: c.met ? "#16A34A" : "#A2492C" }}
        >
          {c.met ? <Check size={16} color="#FFFFFF" /> : <Gift size={16} color="#FFFFFF" />}
        </View>
        <View style={{ flex: 1 }}>
          <Text className="text-white" style={{ fontSize: 13, fontFamily: "SpaceGrotesk_500Medium" }}>
            {c.message}
          </Text>
          {!c.met && (
            <View style={{ marginTop: 6, height: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)" }}>
              <View
                style={{ width: `${Math.round(c.progressPct * 100)}%`, height: 4, borderRadius: 999, backgroundColor: "#FBBF24" }}
              />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
