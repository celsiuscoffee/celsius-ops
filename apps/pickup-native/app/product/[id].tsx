import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  TextInput,
  useWindowDimensions,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { ArrowLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMenu, type ModifierGroup } from "../../lib/menu";
import { useApp, type ModifierSelection } from "../../lib/store";
import { trackEvent } from "../../lib/analytics";
import { formatPrice } from "../../lib/api";
import { CelsiusLoader } from "../../components/CelsiusLoader";

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const outletId = useApp((s) => s.outletId);
  const { data, isLoading } = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
  });
  const product = data?.products.find((p) => p.id === id);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const addToCart = useApp((s) => s.addToCart);

  // Pre-fill single-select modifier groups with their default option
  // (or first option as a fallback) the first time we see the product.
  // Without this, customers can tap Add to cart without selecting a
  // size and end up with an ambiguous line. Multi-select groups stay
  // empty — those are genuinely optional.
  useEffect(() => {
    if (!product) return;
    const initial: Record<string, string[]> = {};
    for (const g of product.modifiers ?? []) {
      if (g.multiSelect) continue;
      const def = g.options.find((o) => o.isDefault) ?? g.options[0];
      if (def) initial[g.id] = [def.id];
    }
    setSelections((cur) => (Object.keys(cur).length === 0 ? initial : cur));
    trackEvent("product_viewed", {
      productId:   product.id,
      productName: product.name,
      price:       product.price,
      outletId,
    });
  }, [product, outletId]);

  // Required = every single-select group must have one selected.
  // Used to gate the Add to cart button so customers can't ship an
  // incomplete order.
  const allRequiredPicked =
    !product ||
    (product.modifiers ?? [])
      .filter((g) => !g.multiSelect)
      .every((g) => (selections[g.id] ?? []).length > 0);

  const totalPrice = useMemo(() => {
    if (!product) return 0;
    const modifierTotal = (product.modifiers ?? []).reduce((sum, g) => {
      const selected = selections[g.id] ?? [];
      return (
        sum +
        selected.reduce(
          (s, optId) => s + (g.options.find((o) => o.id === optId)?.priceDelta ?? 0),
          0
        )
      );
    }, 0);
    return (product.price + modifierTotal) * qty;
  }, [product, selections, qty]);

  if (isLoading || !product) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <CelsiusLoader size="md" />
      </View>
    );
  }

  const toggleOption = (group: ModifierGroup, optionId: string) => {
    Haptics.selectionAsync();
    setSelections((cur) => {
      const existing = cur[group.id] ?? [];
      if (group.multiSelect) {
        return {
          ...cur,
          [group.id]: existing.includes(optionId)
            ? existing.filter((x) => x !== optionId)
            : [...existing, optionId],
        };
      }
      return { ...cur, [group.id]: [optionId] };
    });
  };

  const onAdd = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const flatSelections: ModifierSelection[] = (product.modifiers ?? []).flatMap((g) =>
      (selections[g.id] ?? [])
        .map((optId) => {
          const opt = g.options.find((o) => o.id === optId);
          if (!opt) return null;
          return {
            groupId: g.id,
            groupName: g.name,
            optionId: opt.id,
            label: opt.label,
            priceDelta: opt.priceDelta,
          };
        })
        .filter((x): x is ModifierSelection => x !== null)
    );
    addToCart({
      productId: product.id,
      name: product.name,
      image: product.image_url ?? undefined,
      basePrice: product.price,
      quantity: qty,
      modifiers: flatSelections,
      specialInstructions: notes || undefined,
      totalPrice,
    });
    trackEvent("cart_add", {
      productId:   product.id,
      productName: product.name,
      quantity:    qty,
      totalPrice,
      hasNotes:    !!notes,
      outletId,
    });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView contentContainerClassName="pb-32" stickyHeaderIndices={[]}>
        {product.image_url && (
          <Image
            source={{ uri: product.image_url }}
            style={{ width: "100%", height: screenH * 0.5 }}
            resizeMode="cover"
          />
        )}
        {/* Back button always renders, regardless of image — products
            without images previously had no way back. Floating circle
            on top so it works whether the image is there (overlaid
            with shadow) or not (sits on the white body). */}
        <Pressable
          onPress={() => router.back()}
          className="absolute left-4 w-10 h-10 rounded-full bg-white items-center justify-center active:opacity-80"
          style={{
            top: insets.top + 8,
            shadowColor: "#000",
            shadowOpacity: 0.2,
            shadowRadius: 6,
            zIndex: 10,
          }}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to menu"
        >
          <ArrowLeft size={20} color="#160800" />
        </Pressable>

        {/* rounded-t-2xl per the brand corner-radius rule (no 3xl
            anywhere). The bg curves up over the image so the
            transition reads as a card sliding over a poster. */}
        <View className="bg-background -mt-6 rounded-t-2xl pt-6 px-5">
          <Text
            className="text-espresso text-2xl"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            {product.name}
          </Text>
          {product.description && (
            <Text className="text-muted-fg text-sm mt-2 leading-relaxed">
              {product.description}
            </Text>
          )}
          <Text
            className="text-primary text-xl mt-3"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            {formatPrice(product.price)}
          </Text>

          {(product.modifiers ?? []).map((g) => (
            <View key={g.id} className="mt-6">
              <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
                {g.name}
                {!g.multiSelect && (
                  <Text className="text-primary"> · pick one</Text>
                )}
              </Text>
              <View className="mt-2 gap-2">
                {g.options.map((opt) => {
                  const selected = (selections[g.id] ?? []).includes(opt.id);
                  return (
                    <Pressable
                      key={opt.id}
                      onPress={() => toggleOption(g, opt.id)}
                      className={`px-4 py-3 rounded-2xl border flex-row justify-between items-center active:opacity-70 ${
                        selected
                          ? "bg-primary/8 border-primary"
                          : "bg-surface border-border"
                      }`}
                    >
                      <Text className={selected ? "text-primary font-bold" : "text-espresso"}>
                        {opt.label}
                      </Text>
                      {opt.priceDelta !== 0 && (
                        <Text className="text-muted-fg text-xs">
                          {opt.priceDelta > 0 ? "+" : ""}
                          {formatPrice(opt.priceDelta)}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          <View className="mt-6">
            <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
              Special instructions
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything we should know?"
              placeholderTextColor="#8E8E93"
              className="mt-2 bg-surface border border-border rounded-2xl px-4 py-3 text-espresso"
              multiline
            />
          </View>

          <View className="mt-6 flex-row items-center justify-between">
            <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
              Quantity
            </Text>
            <View className="flex-row items-center gap-4">
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setQty((q) => Math.max(1, q - 1));
                }}
                disabled={qty <= 1}
                className="w-10 h-10 rounded-full bg-surface border border-border items-center justify-center active:opacity-70"
                style={{ opacity: qty <= 1 ? 0.4 : 1 }}
                accessibilityRole="button"
                accessibilityLabel="Decrease quantity"
                accessibilityState={{ disabled: qty <= 1 }}
              >
                <Text className="text-espresso text-xl">−</Text>
              </Pressable>
              <Text
                className="text-espresso text-xl w-8 text-center font-bold"
                accessibilityLabel={`Quantity ${qty}`}
              >
                {qty}
              </Text>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setQty((q) => q + 1);
                }}
                className="w-10 h-10 rounded-full bg-espresso items-center justify-center active:opacity-70"
                accessibilityRole="button"
                accessibilityLabel="Increase quantity"
              >
                <Text className="text-white text-xl">+</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 right-0 px-4 pt-3 bg-background border-t border-border"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Pressable
          onPress={onAdd}
          disabled={!allRequiredPicked}
          className={`rounded-full py-4 flex-row justify-center items-center gap-2 active:opacity-80 ${
            allRequiredPicked ? "bg-primary" : "bg-primary/40"
          }`}
          accessibilityRole="button"
          accessibilityLabel={`Add to cart, ${formatPrice(totalPrice)}`}
          accessibilityState={{ disabled: !allRequiredPicked }}
        >
          {allRequiredPicked ? (
            <>
              <Text className="text-white font-bold text-base">Add to cart</Text>
              <Text className="text-white font-bold text-base">·</Text>
              <Text className="text-white font-bold text-base">{formatPrice(totalPrice)}</Text>
            </>
          ) : (
            <Text className="text-white font-bold text-base">Pick options first</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
