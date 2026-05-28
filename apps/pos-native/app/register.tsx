import { useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, Image, ScrollView } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { Plus, Minus, Trash2, LogOut } from "lucide-react-native";
import { usePos } from "@/lib/store";
import { fetchCategories, fetchProducts, type Product } from "@/lib/menu";
import { useCart, cartSubtotal } from "@/lib/cart";

const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

export default function Register() {
  const { staff, outletId, signOut } = usePos();
  const [activeCat, setActiveCat] = useState<string>("all");

  const cats = useQuery({ queryKey: ["pos-categories"], queryFn: fetchCategories });
  const prods = useQuery({ queryKey: ["pos-products"], queryFn: fetchProducts });

  const lines = useCart((s) => s.lines);
  const add = useCart((s) => s.add);
  const inc = useCart((s) => s.inc);
  const dec = useCart((s) => s.dec);
  const clear = useCart((s) => s.clear);

  // Only show category tabs that actually have available products.
  const liveCats = useMemo(() => {
    const present = new Set((prods.data ?? []).map((p) => p.category));
    return (cats.data ?? []).filter((c) => present.has(c.slug) || present.has(c.id));
  }, [cats.data, prods.data]);

  const visible = useMemo(() => {
    const all = prods.data ?? [];
    if (activeCat === "all") return all;
    return all.filter((p) => p.category === activeCat);
  }, [prods.data, activeCat]);

  const subtotal = cartSubtotal(lines);

  function onAdd(p: Product) {
    Haptics.selectionAsync();
    // NOTE: products with modifier groups should open a picker — that
    // modal is the next slice. For now we add the base product.
    add(p);
  }

  return (
    <View className="flex-1 bg-espresso flex-row">
      {/* ── Main: catalog ───────────────────────────── */}
      <View className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <View className="flex-row items-center gap-3">
            <View className="h-9 w-9 rounded-xl bg-cream items-center justify-center">
              <Text className="text-espresso text-lg" style={{ fontFamily: "Peachi-Bold" }}>°C</Text>
            </View>
            <View>
              <Text className="text-cream text-base" style={{ fontFamily: "Peachi-Bold" }}>Celsius POS</Text>
              <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                {staff?.staffName ?? ""} · {outletId ?? ""}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => { signOut(); router.replace("/"); }}
            className="flex-row items-center gap-2 px-3 py-2 rounded-xl border border-cream/15 active:opacity-60"
          >
            <LogOut size={16} color="rgba(245,243,240,0.7)" />
            <Text className="text-cream/70 text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>Sign out</Text>
          </Pressable>
        </View>

        {/* Category tabs */}
        <View className="h-12">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: "center" }}>
            <CatTab label="All" active={activeCat === "all"} onPress={() => setActiveCat("all")} />
            {liveCats.map((c) => (
              <CatTab
                key={c.id}
                label={c.name}
                active={activeCat === c.slug || activeCat === c.id}
                onPress={() => setActiveCat(c.slug || c.id)}
              />
            ))}
          </ScrollView>
        </View>

        {/* Product grid */}
        {prods.isLoading ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color="#FBBF24" /></View>
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(p) => p.id}
            numColumns={4}
            contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
            columnWrapperStyle={{ gap: 10 }}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item }) => <ProductTile product={item} onPress={() => onAdd(item)} />}
            removeClippedSubviews
            initialNumToRender={16}
            windowSize={5}
          />
        )}
      </View>

      {/* ── Cart panel ──────────────────────────────── */}
      <View className="w-[360px] bg-surface border-l border-border">
        <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
          <Text className="text-cream text-lg" style={{ fontFamily: "Peachi-Bold" }}>Current Order</Text>
          {lines.length > 0 && (
            <Pressable onPress={() => { Haptics.selectionAsync(); clear(); }} className="active:opacity-60">
              <Text className="text-primary text-xs" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>CLEAR</Text>
            </Pressable>
          )}
        </View>

        {lines.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="text-cream/30 text-center" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
              Tap products to start an order
            </Text>
          </View>
        ) : (
          <FlatList
            data={lines}
            keyExtractor={(l) => l.key}
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: 12 }}
            renderItem={({ item }) => (
              <View className="flex-row items-center py-3 border-b border-border">
                <View className="flex-1 pr-2">
                  <Text className="text-cream text-[13px]" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={1}>
                    {item.product.name}
                  </Text>
                  {item.modifiers.length > 0 && (
                    <Text className="text-cream/45 text-[11px]" style={{ fontFamily: "SpaceGrotesk_400Regular" }} numberOfLines={1}>
                      {item.modifiers.map((m) => m.name).join(", ")}
                    </Text>
                  )}
                  <Text className="text-cream/55 text-[11px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>
                    {rm(item.unit_sen)}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Stepper icon={<Minus size={14} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); dec(item.key); }} />
                  <Text className="text-cream w-6 text-center" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{item.qty}</Text>
                  <Stepper icon={<Plus size={14} color="#F5F3F0" />} onPress={() => { Haptics.selectionAsync(); inc(item.key); }} />
                </View>
                <Text className="text-cream w-[72px] text-right text-[13px]" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                  {rm(item.unit_sen * item.qty)}
                </Text>
              </View>
            )}
          />
        )}

        {/* Totals + charge */}
        <View className="px-5 pt-3 pb-6 border-t border-border">
          <View className="flex-row justify-between mb-1">
            <Text className="text-cream/55 text-sm" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>Subtotal</Text>
            <Text className="text-cream/80 text-sm" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{rm(subtotal)}</Text>
          </View>
          <View className="flex-row justify-between items-baseline mb-4">
            <Text className="text-cream text-lg" style={{ fontFamily: "Peachi-Bold" }}>Total</Text>
            <Text className="text-amber-400 text-2xl" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(subtotal)}</Text>
          </View>
          <Pressable
            disabled={lines.length === 0}
            onPress={() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}
            className={`h-14 rounded-2xl items-center justify-center ${lines.length === 0 ? "bg-primary/30" : "bg-primary active:opacity-80"}`}
          >
            <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
              {lines.length === 0 ? "Add items" : `Charge ${rm(subtotal)}`}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CatTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`px-4 py-2 rounded-full border ${active ? "bg-cream border-cream" : "border-cream/15"}`}
    >
      <Text className={active ? "text-espresso" : "text-cream/70"} style={{ fontFamily: "SpaceGrotesk_600SemiBold", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ProductTile({ product, onPress }: { product: Product; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 rounded-2xl overflow-hidden border border-border active:opacity-70"
      style={{ backgroundColor: "rgba(245,243,240,0.04)" }}
    >
      <View className="aspect-square w-full bg-cream/5">
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} className="w-full h-full" resizeMode="cover" />
        ) : null}
      </View>
      <View className="px-2 py-2">
        <Text className="text-cream text-[12px]" style={{ fontFamily: "Peachi-Medium" }} numberOfLines={2}>
          {product.name}
        </Text>
        <Text className="text-amber-400 text-[12px] mt-0.5" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
          {rm(product.price_sen)}
        </Text>
      </View>
    </Pressable>
  );
}

function Stepper({ icon, onPress }: { icon: React.ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-7 w-7 rounded-full items-center justify-center active:opacity-60"
      style={{ backgroundColor: "rgba(245,243,240,0.08)" }}
    >
      {icon}
    </Pressable>
  );
}
