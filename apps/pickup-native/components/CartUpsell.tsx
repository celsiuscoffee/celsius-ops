import { View, Text, Pressable } from "react-native";
import { router } from "expo-router";
import { Plus } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "@/lib/haptics";
import { ProductImage } from "./ProductImage";
import { cloudinaryThumb } from "../lib/image";
import { formatPrice } from "../lib/api";
import { fetchCartPairs } from "../lib/suggest-pairs";

/**
 * In-cart upsell — "Goes well with your order". Basket-targeted (drinks cart →
 * a bite) + personalized by member, via the shared pairing engine
 * (/api/suggest-pairs). Rendered as full-width rows in the SAME card style as
 * the cart items above (contained, both-side margins) — not an edge-to-edge
 * side rail. Tapping a row opens the product page. Renders nothing until it has
 * a suggestion.
 */
export function CartUpsell({
  productIds,
  loyaltyId,
  outletId,
}: {
  productIds: string[];
  loyaltyId: string | null;
  outletId: string | null;
}) {
  const key = productIds.slice().sort().join(",");
  const { data } = useQuery({
    queryKey: ["cart-pairs", key, loyaltyId],
    queryFn: () => fetchCartPairs(productIds, loyaltyId, outletId),
    enabled: productIds.length > 0,
    staleTime: 60_000,
  });
  const pairs = data ?? [];
  if (pairs.length === 0) return null;

  return (
    <View className="mt-1 mb-4">
      <View className="px-4 mb-2">
        <Text
          className="text-espresso text-[13px] uppercase"
          style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.2 }}
        >
          Goes well with your order
        </Text>
      </View>
      <View className="px-4" style={{ gap: 12 }}>
        {pairs.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => {
              Haptics.selectionAsync();
              router.push({ pathname: "/product/[id]", params: { id: p.id } });
            }}
            className="bg-surface flex-row items-center border border-border active:opacity-70"
            style={{ borderRadius: 16, padding: 12, gap: 12 }}
          >
            <View style={{ width: 56, height: 56, borderRadius: 10, overflow: "hidden" }}>
              <ProductImage uri={cloudinaryThumb(p.image, { size: 112 })} width={56} height={56} />
            </View>
            <View className="flex-1">
              <Text className="text-espresso text-[14px]" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>
                {p.name}
              </Text>
              <Text
                className="text-primary text-[9px] uppercase"
                style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5, marginTop: 2 }}
                numberOfLines={1}
              >
                {p.discountLabel ?? p.reason}
              </Text>
            </View>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="text-primary text-[14px]" style={{ fontFamily: "Peachi-Bold" }}>
                {formatPrice(p.basePrice)}
              </Text>
              <View className="bg-espresso rounded-full items-center justify-center" style={{ width: 28, height: 28 }}>
                <Plus size={15} color="#FFFFFF" />
              </View>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
