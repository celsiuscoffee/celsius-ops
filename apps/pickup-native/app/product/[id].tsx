import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  TextInput,
  useWindowDimensions,
  Keyboard,
  Platform,
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
  // `cartId` is set when the customer tapped an existing cart line to
  // edit it. When present we run in edit mode: prefill modifiers / qty
  // / notes from the existing line, swap the CTA to "Update cart", and
  // replace the line in-place on submit (so it keeps its position).
  // Without `cartId` we behave as before — fresh "Add to cart" flow.
  const { id, cartId } = useLocalSearchParams<{ id: string; cartId?: string }>();
  const editingCartId = typeof cartId === "string" && cartId.length > 0 ? cartId : null;
  const isEditing = editingCartId !== null;
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const noteY = useRef<number | null>(null);
  const [noteFocused, setNoteFocused] = useState(false);
  // Track keyboard visibility so we can collapse the bottom Add to
  // Cart bar while the customer is typing notes — frees the screen
  // from "input + huge dead zone + button + keyboard" stacking and
  // matches the pattern used by Twitter/iMessage/Notion compose flows.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardOpen(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardOpen(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const outletId = useApp((s) => s.outletId);
  const { data, isLoading } = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
  });
  const product = data?.products.find((p) => p.id === id);
  // Look up the existing cart line up-front when we're in edit mode so
  // the prefill effect below has something concrete to read from.
  const existingCartItem = useApp((s) =>
    editingCartId ? s.cart.find((i) => i.cartId === editingCartId) ?? null : null,
  );
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const addToCart = useApp((s) => s.addToCart);
  const replaceCartItem = useApp((s) => s.replaceCartItem);

  // Modifier groups hidden from customer view. Same set the order
  // PWA uses (product-detail-content.tsx) — keeps the two surfaces
  // in lock-step. Pickup orders are by definition take-away so the
  // POS / kitchen handles packaging on its own; surfacing it in the
  // app just adds a forced click for the customer with no real
  // choice (all our packaging is the same cup).
  const HIDDEN_GROUPS = useMemo(() => new Set(["packaging", "package"]), []);
  const visibleModifiers = useMemo(
    () => (product?.modifiers ?? []).filter(
      (g) => !HIDDEN_GROUPS.has((g.name ?? "").toLowerCase()),
    ),
    [product, HIDDEN_GROUPS],
  );

  // Pre-fill modifiers / qty / notes. Two paths:
  //
  // 1. Edit mode (`existingCartItem` set): rebuild `selections` from
  //    the cart line's saved modifiers, restore qty + notes verbatim.
  //    The customer should land on the product page seeing exactly
  //    what's currently in their cart, with no surprise re-selection.
  //
  // 2. Fresh add (default): seed single-select VISIBLE groups with
  //    their default option (or first option as a fallback). Without
  //    this, customers can tap Add to cart without selecting a size
  //    and end up with an ambiguous line. Multi-select groups stay
  //    empty — those are genuinely optional. Only walks VISIBLE
  //    groups so the hidden packaging group doesn't sneak into the
  //    cart payload.
  useEffect(() => {
    if (!product) return;
    if (existingCartItem) {
      const fromCart: Record<string, string[]> = {};
      for (const m of existingCartItem.modifiers) {
        const list = fromCart[m.groupId] ?? [];
        list.push(m.optionId);
        fromCart[m.groupId] = list;
      }
      setSelections((cur) => (Object.keys(cur).length === 0 ? fromCart : cur));
      setQty((cur) => (cur === 1 ? existingCartItem.quantity : cur));
      setNotes((cur) => (cur === "" ? existingCartItem.specialInstructions ?? "" : cur));
    } else {
      const initial: Record<string, string[]> = {};
      for (const g of visibleModifiers) {
        if (g.multiSelect) continue;
        const def = g.options.find((o) => o.isDefault) ?? g.options[0];
        if (def) initial[g.id] = [def.id];
      }
      setSelections((cur) => (Object.keys(cur).length === 0 ? initial : cur));
    }
    trackEvent("product_viewed", {
      productId:   product.id,
      productName: product.name,
      price:       product.price,
      outletId,
    });
  }, [product, outletId, visibleModifiers, existingCartItem]);

  // Required = every single-select VISIBLE group must have one
  // selected. Hidden groups never block the button.
  const allRequiredPicked =
    !product ||
    visibleModifiers
      .filter((g) => !g.multiSelect)
      .every((g) => (selections[g.id] ?? []).length > 0);

  const totalPrice = useMemo(() => {
    if (!product) return 0;
    // Price only walks VISIBLE modifiers so a hidden packaging
    // price-delta never silently inflates the customer's total.
    const modifierTotal = visibleModifiers.reduce((sum, g) => {
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
  }, [product, selections, qty, visibleModifiers]);

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
    // Only emit selections from VISIBLE groups so the hidden packaging
    // option never lands in the cart line / order payload.
    const flatSelections: ModifierSelection[] = visibleModifiers.flatMap((g) =>
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
    const payload = {
      productId: product.id,
      name: product.name,
      image: product.image_url ?? undefined,
      category: product.category,
      basePrice: product.price,
      quantity: qty,
      modifiers: flatSelections,
      specialInstructions: notes || undefined,
      totalPrice,
    };
    if (isEditing && editingCartId) {
      // Edit mode: swap the existing line in-place so it stays where
      // the customer last saw it in the cart list, and emit a distinct
      // analytics event so we can tell edits apart from net-new adds.
      replaceCartItem(editingCartId, payload);
      trackEvent("cart_edit", {
        productId:   product.id,
        productName: product.name,
        quantity:    qty,
        totalPrice,
        hasNotes:    !!notes,
        outletId,
      });
    } else {
      addToCart(payload);
      trackEvent("cart_add", {
        productId:   product.id,
        productName: product.name,
        quantity:    qty,
        totalPrice,
        hasNotes:    !!notes,
        outletId,
      });
    }
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        ref={scrollRef}
        // Dynamic bottom padding — big enough to clear the absolute
        // Add-to-Cart bar when the keyboard is closed (~120px), then
        // collapses to a small breathing space when the keyboard is
        // up (the bar is hidden anyway). Stops the customer from
        // scrolling into a giant empty zone past the actual content,
        // matching the bounded-scroll feel of Grab/Foodpanda's
        // product modal.
        contentContainerStyle={{ paddingBottom: keyboardOpen ? 16 : 120 }}
        stickyHeaderIndices={[]}
        automaticallyAdjustKeyboardInsets
        automaticallyAdjustsScrollIndicatorInsets
        keyboardShouldPersistTaps="handled"
      >
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

          {visibleModifiers.map((g) => (
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

          <View
            className="mt-6"
            onLayout={(e) => { noteY.current = e.nativeEvent.layout.y; }}
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-espresso text-xs font-bold uppercase tracking-wider">
                Special instructions
              </Text>
              <Text className="text-muted-fg text-[10px] uppercase tracking-wider">
                Optional
              </Text>
            </View>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Anything we should know? (e.g. less sweet, no ice)"
              placeholderTextColor="#8E8E93"
              multiline
              textAlignVertical="top"
              maxLength={140}
              style={{
                marginTop: 8,
                backgroundColor: "#FAF7F2",
                borderWidth: 1,
                borderColor: noteFocused ? "#C05040" : "rgba(26,8,0,0.10)",
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 12,
                fontSize: 14,
                color: "#160800",
                fontFamily: "SpaceGrotesk_400Regular",
                minHeight: 92,
              }}
              onFocus={() => {
                setNoteFocused(true);
                // The bottom Add-to-Cart bar hides while the
                // keyboard is up, so the auto-adjust on iOS already
                // clears the input. Scroll a touch more so the
                // section header stays visible above the input —
                // orients the customer when they glance back up.
                if (noteY.current != null) {
                  scrollRef.current?.scrollTo({
                    y: Math.max(0, noteY.current - 24),
                    animated: true,
                  });
                }
              }}
              onBlur={() => setNoteFocused(false)}
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

      {/* Bottom Add-to-Cart bar — hidden while the keyboard is up so
          the customer typing in Special Instructions sees their text
          docked just above the keyboard with no dead space below.
          The bar pops back the moment they dismiss the keyboard. */}
      {!keyboardOpen && (
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
          accessibilityLabel={`${isEditing ? "Update cart" : "Add to cart"}, ${formatPrice(totalPrice)}`}
          accessibilityState={{ disabled: !allRequiredPicked }}
        >
          {allRequiredPicked ? (
            <>
              <Text className="text-white font-bold text-base">
                {isEditing ? "Update cart" : "Add to cart"}
              </Text>
              <Text className="text-white font-bold text-base">·</Text>
              <Text className="text-white font-bold text-base">{formatPrice(totalPrice)}</Text>
            </>
          ) : (
            <Text className="text-white font-bold text-base">Pick options first</Text>
          )}
        </Pressable>
      </View>
      )}
    </View>
  );
}
