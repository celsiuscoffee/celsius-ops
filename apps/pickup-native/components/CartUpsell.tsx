import { View, Text, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import { Plus } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "@/lib/haptics";
import { ProductImage } from "./ProductImage";
import { cloudinaryThumb } from "../lib/image";
import { formatPrice } from "../lib/api";
import { fetchCartPairs } from "../lib/suggest-pairs";

/**
 * In-cart upsell rail — "Goes well with your order". Basket-targeted (drinks
 * cart → a bite) + personalized by member, via the shared pairing engine
 * (/api/suggest-pairs). Cards open the product page (one tap to add), mirroring
 * the empty-cart best-seller rail. Renders nothing until it has a suggestion.
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
    <View className="mt-2 mb-4">
      <View className="px-4 mb-2">
        <Text
          className="text-espresso text-[13px] uppercase"
          style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1.2 }}
        >
          Goes well with your order
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-4">
        {pairs.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => {
              Haptics.selectionAsync();
              router.push({ pathname: "/product/[id]", params: { id: p.id } });
            }}
            className="w-40 bg-surface rounded-2xl border border-border overflow-hidden active:opacity-70"
            style={{ shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }}
          >
            <View>
              <ProductImage uri={cloudinaryThumb(p.image, { size: 160 })} width={160} height={130} />
              <View className="absolute top-2 left-2 bg-espresso/90 rounded-full px-2 py-0.5">
                <Text
                  className="text-amber-400 text-[8px] uppercase"
                  style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }}
                  numberOfLines={1}
                >
                  {p.discountLabel ?? p.reason}
                </Text>
              </View>
            </View>
            <View className="px-3 py-2.5">
              <Text className="text-espresso text-[13px]" style={{ fontFamily: "Peachi-Bold" }} numberOfLines={1}>
                {p.name}
              </Text>
              <View className="flex-row items-center justify-between mt-1">
                <Text className="text-primary text-[14px]" style={{ fontFamily: "Peachi-Bold" }}>
                  {formatPrice(p.basePrice)}
                </Text>
                <View className="bg-espresso rounded-full items-center justify-center" style={{ width: 24, height: 24 }}>
                  <Plus size={14} color="#FFFFFF" />
                </View>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
