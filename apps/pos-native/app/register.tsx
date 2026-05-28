import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator, Image, ScrollView, Modal } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";
import { Plus, Minus, LogOut, Banknote, CreditCard, QrCode, X, CheckCircle2 } from "lucide-react-native";
import { usePos } from "@/lib/store";
import { fetchCategories, fetchProducts, type Product, type ModifierOption } from "@/lib/menu";
import { useCart, cartSubtotal } from "@/lib/cart";
import { useDisplay } from "@/lib/display";
import { createSale } from "@/lib/checkout";

const rm = (sen: number) => `RM ${(sen / 100).toFixed(2)}`;

export default function Register() {
  const { staff, outletId, signOut } = usePos();
  const [activeCat, setActiveCat] = useState<string>("all");
  const [showCheckout, setShowCheckout] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<{ orderNumber: string; total: number } | null>(null);
  const [modProduct, setModProduct] = useState<Product | null>(null);
  const setDisplayStatus = useDisplay((s) => s.setStatus);
  const setOrderNumber = useDisplay((s) => s.setOrderNumber);

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

  // Mirror cart state to the customer-display: ordering while a cart is
  // open, idle when empty (unless we're showing a paid confirmation).
  useEffect(() => {
    if (paid) return;
    setDisplayStatus(lines.length > 0 ? "ordering" : "idle");
  }, [lines.length, paid]);

  function onAdd(p: Product) {
    Haptics.selectionAsync();
    // Products with modifier groups open the picker so the cashier can
    // choose options (and we charge the add-on prices). No-modifier
    // products drop straight into the cart.
    if (p.modifiers.length > 0) {
      setModProduct(p);
    } else {
      add(p);
    }
  }

  async function pay(method: string) {
    if (!outletId || !staff || paying) return;
    setPaying(true);
    try {
      const sale = await createSale({
        outletId,
        staffId: staff.staffId,
        lines,
        orderType: "takeaway",
        paymentMethod: method,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOrderNumber(sale.orderNumber);
      setDisplayStatus("complete");
      setPaid({ orderNumber: sale.orderNumber, total: sale.total });
      clear();
      setShowCheckout(false);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.error("[checkout]", e?.message ?? e);
      // Surface minimally — keep the modal open so the cashier can retry.
      alert(`Checkout failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setPaying(false);
    }
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
            onPress={() => { Haptics.selectionAsync(); setShowCheckout(true); }}
            className={`h-14 rounded-2xl items-center justify-center ${lines.length === 0 ? "bg-primary/30" : "bg-primary active:opacity-80"}`}
          >
            <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
              {lines.length === 0 ? "Add items" : `Charge ${rm(subtotal)}`}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── Checkout: payment method sheet ── */}
      <Modal visible={showCheckout} transparent animationType="fade" onRequestClose={() => setShowCheckout(false)}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="w-[480px] rounded-3xl bg-surface border border-border p-7">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>Payment</Text>
              <Pressable onPress={() => setShowCheckout(false)} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
            </View>
            <Text className="text-amber-400 text-4xl mb-6" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(subtotal)}</Text>
            {paying ? (
              <View className="h-40 items-center justify-center"><ActivityIndicator color="#FBBF24" size="large" /></View>
            ) : (
              <View className="gap-3">
                <PayMethod icon={<Banknote size={22} color="#F5F3F0" />} label="Cash" onPress={() => pay("cash")} />
                <PayMethod icon={<CreditCard size={22} color="#F5F3F0" />} label="Card" onPress={() => pay("card")} />
                <PayMethod icon={<QrCode size={22} color="#F5F3F0" />} label="QR / E-wallet" onPress={() => pay("qr")} />
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Modifier picker ── */}
      <Modal visible={!!modProduct} transparent animationType="fade" onRequestClose={() => setModProduct(null)}>
        {modProduct && (
          <ModifierSheet
            product={modProduct}
            onClose={() => setModProduct(null)}
            onConfirm={(opts) => { add(modProduct, opts); Haptics.selectionAsync(); setModProduct(null); }}
          />
        )}
      </Modal>

      {/* ── Paid confirmation ── */}
      <Modal visible={!!paid} transparent animationType="fade" onRequestClose={() => { setPaid(null); setDisplayStatus("idle"); }}>
        <View className="flex-1 bg-black/70 items-center justify-center px-8">
          <View className="w-[460px] rounded-3xl bg-surface border border-border p-8 items-center">
            <CheckCircle2 size={64} color="#86efac" />
            <Text className="text-cream text-2xl mt-4" style={{ fontFamily: "Peachi-Bold" }}>Paid</Text>
            <Text className="text-cream/55 mt-1" style={{ fontFamily: "SpaceGrotesk_500Medium" }}>{paid?.orderNumber}</Text>
            <Text className="text-amber-400 text-4xl mt-3 mb-6" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
              {paid ? rm(paid.total) : ""}
            </Text>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setPaid(null); setDisplayStatus("idle"); }}
              className="h-13 px-8 py-3.5 rounded-2xl bg-primary active:opacity-80"
            >
              <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>New Order</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ModifierSheet({
  product, onClose, onConfirm,
}: {
  product: Product;
  onClose: () => void;
  onConfirm: (opts: ModifierOption[]) => void;
}) {
  // selected option ids per group.
  const [sel, setSel] = useState<Record<string, string[]>>({});

  function toggle(groupId: string, optId: string, multi: boolean) {
    Haptics.selectionAsync();
    setSel((cur) => {
      const have = cur[groupId] ?? [];
      if (multi) {
        return { ...cur, [groupId]: have.includes(optId) ? have.filter((x) => x !== optId) : [...have, optId] };
      }
      return { ...cur, [groupId]: have.includes(optId) ? [] : [optId] };
    });
  }

  // Flatten selected options + sum add-on price. Required groups must
  // have at least one pick before we allow Add.
  const chosen: ModifierOption[] = [];
  for (const g of product.modifiers) {
    const ids = sel[g.id] ?? [];
    for (const o of g.options) if (ids.includes(o.id)) chosen.push(o);
  }
  const addOn = chosen.reduce((s, o) => s + o.price_sen, 0);
  const missingRequired = product.modifiers.some((g) => g.required && (sel[g.id] ?? []).length === 0);

  return (
    <View className="flex-1 bg-black/70 items-center justify-center px-8">
      <View className="w-[560px] max-h-[88%] rounded-3xl bg-surface border border-border p-6">
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-cream text-xl" style={{ fontFamily: "Peachi-Bold" }}>{product.name}</Text>
            <Text className="text-amber-400 text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>{rm(product.price_sen)}</Text>
          </View>
          <Pressable onPress={onClose} className="active:opacity-60"><X size={22} color="rgba(245,243,240,0.7)" /></Pressable>
        </View>

        <ScrollView className="max-h-[420px]">
          {product.modifiers.map((g) => (
            <View key={g.id} className="mb-4">
              <Text className="text-cream/55 text-xs tracking-[1.5px] mb-2" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
                {g.name.toUpperCase()}{g.required ? "  • REQUIRED" : ""}{g.multi ? "  • MULTI" : ""}
              </Text>
              <View className="gap-2">
                {g.options.map((o) => {
                  const on = (sel[g.id] ?? []).includes(o.id);
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => toggle(g.id, o.id, g.multi)}
                      className={`flex-row items-center justify-between h-12 px-4 rounded-2xl border ${on ? "border-amber-400 bg-amber-400/10" : "border-border"}`}
                      style={!on ? { backgroundColor: "rgba(245,243,240,0.04)" } : undefined}
                    >
                      <Text className={on ? "text-cream" : "text-cream/75"} style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                        {o.name}
                      </Text>
                      <Text className={on ? "text-amber-400" : "text-cream/45"} style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>
                        {o.price_sen > 0 ? `+${rm(o.price_sen)}` : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        <Pressable
          disabled={missingRequired}
          onPress={() => onConfirm(chosen)}
          className={`h-14 rounded-2xl items-center justify-center mt-3 ${missingRequired ? "bg-primary/30" : "bg-primary active:opacity-80"}`}
        >
          <Text className="text-cream text-base" style={{ fontFamily: "SpaceGrotesk_700Bold" }}>
            {missingRequired ? "Select required options" : `Add — ${rm(product.price_sen + addOn)}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function PayMethod({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-4 h-16 px-5 rounded-2xl border border-border active:opacity-70"
      style={{ backgroundColor: "rgba(245,243,240,0.05)" }}
    >
      {icon}
      <Text className="text-cream text-lg" style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}>{label}</Text>
    </Pressable>
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
