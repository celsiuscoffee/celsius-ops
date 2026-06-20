import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  InputAccessoryView,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "@/lib/haptics";
import { ArrowLeft } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMenu, type ModifierGroup } from "../../lib/menu";
import { useApp, type ModifierSelection } from "../../lib/store";
import { trackEvent } from "../../lib/analytics";
import { formatPrice } from "../../lib/api";
import { PairWith, defaultPairLinePrice } from "../../components/PairWith";
import { ProductImage } from "../../components/ProductImage";
import { ProductPageSkeleton } from "../../components/ProductPageSkeleton";
import type { Product } from "../../lib/menu";
import { cloudinaryThumb } from "../../lib/image";
import { useActiveSales } from "../../lib/use-active-sales";
import { bestSaleForProduct } from "../../lib/product-sales";
import { PriceTag } from "../../components/PriceTag";
import { fetchActiveCombos, bestComboForPair } from "../../lib/combos";

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
  const { height: screenH, width: screenW } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const scrollViewH = useRef(0); // ScrollView frame height — for keyboard-clear math
  const noteY = useRef<number | null>(null); // notes section top, in scroll-content coords
  const noteH = useRef(0); // notes section height
  const keyboardH = useRef(0); // current keyboard height (incl. the Done accessory on iOS)
  const bodyY = useRef(0); // white body card's top offset within the scroll content (noteY is relative to the card)
  const [noteFocused, setNoteFocused] = useState(false);
  // Track keyboard visibility so we can collapse the bottom Add to
  // Cart bar while the customer is typing notes — frees the screen
  // from "input + huge dead zone + button + keyboard" stacking and
  // matches the pattern used by Twitter/iMessage/Notion compose flows.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        keyboardH.current = e.endCoordinates?.height ?? 0;
        setKeyboardOpen(true);
      },
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
  // When the notes field is focused and the keyboard comes up, scroll JUST
  // enough that the whole notes box sits a hair above the keyboard — no
  // more. scrollToEnd over-shoots and drags the "Pair with a bite" rail
  // (which lives below the box) into view; we want the box to be the
  // lowest thing on screen, with Quantity + Pair-with-a-bite tucked behind
  // the keyboard.
  //
  // Deferred ~300ms: keyboardOpen flips on `keyboardWillShow` (iOS) but the
  // keyboard height + content-inset only settle as it finishes animating,
  // so an earlier scroll computes a too-short target and clamps half-way.
  useEffect(() => {
    if (!keyboardOpen || !noteFocused) return;
    const t = setTimeout(() => {
      const sv = scrollViewH.current;
      const kb = keyboardH.current;
      // Without measurements, fall back to scroll-to-end (still visible).
      if (noteY.current == null || sv === 0 || kb === 0) {
        scrollRef.current?.scrollToEnd({ animated: true });
        return;
      }
      // Land the box bottom ~16px above the keyboard's top edge. noteY is
      // relative to the body card, so add the card's own offset to get the
      // box bottom in scroll-content coords.
      const noteBottom = bodyY.current + noteY.current + noteH.current;
      const visibleBottom = sv - kb - 16;
      scrollRef.current?.scrollTo({
        y: Math.max(0, noteBottom - visibleBottom),
        animated: true,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [keyboardOpen, noteFocused]);
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
  // iOS keyboard toolbar id. A multiline TextInput can't dismiss via the
  // return key (return inserts a newline), so without a "Done" button the
  // customer is stuck with the keyboard up. An InputAccessoryView gives
  // them an explicit way off the field. iOS-only — Android dismisses via
  // the system back gesture, web by tapping elsewhere.
  const notesAccessoryId = "product-notes-accessory";
  // Staged "pair with" pickings — committed alongside the main
  // product when the customer taps Add to cart. Stays on this screen
  // (never persisted) so backing out of the screen drops them.
  // Stored as full Product objects so we can compute price + carry
  // image/name/category through to addToCart without a re-lookup.
  const [stagedPairs, setStagedPairs] = useState<Product[]>([]);
  const stagedPairIds = useMemo(() => new Set(stagedPairs.map((p) => p.id)), [stagedPairs]);
  const togglePair = useCallback((p: Product) => {
    setStagedPairs((arr) =>
      arr.some((x) => x.id === p.id) ? arr.filter((x) => x.id !== p.id) : [...arr, p],
    );
  }, []);
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

  // Roll-up of staged pairings — each pair is qty 1 with default
  // modifier choices. Used by the Add-to-cart CTA so the price the
  // customer sees on the button matches what hits the cart.
  const stagedPairsTotal = useMemo(
    () => stagedPairs.reduce((sum, p) => sum + defaultPairLinePrice(p), 0),
    [stagedPairs],
  );
  const stagedPairsCount = stagedPairs.length;
  // Sale-shaped per-product promo (e.g. "Latte 10% off"). When active,
  // we apply the same proportional discount to the displayed totals
  // so the bottom CTA matches what the server will bill. Quick math:
  // savings = (base - effective) × qty; if a modifier increases price
  // we don't discount the modifier portion (the promo is per-line
  // base discount, mirrors the loyalty evaluator's behaviour).
  const { sales } = useActiveSales();
  const productSale = useMemo(
    () => (product
      ? bestSaleForProduct({
          sales,
          productId: product.id,
          productCategory: product.category,
          productBasePrice: product.price,
          outletId,
        })
      : null),
    [sales, product, outletId],
  );
  // Apply the sale to the base-product portion of the total. The
  // modifier-driven price delta stays at full price; only the base
  // is discounted per the standard promo math.
  const saleSavingsThisLine = productSale ? productSale.savings * qty : 0;

  // Combo savings preview — when the customer has staged a pair-with
  // item that triggers a combo with the current product, subtract
  // those savings from the bottom CTA so the price the customer sees
  // matches what hits the cart. Without this the CTA showed full
  // bundle price while the green "Combo unlocked — saves RM2" banner
  // above promised the discount, leaving the customer to wonder
  // which number was real. Server still authoritative; this is just
  // the preview lining up with the banner.
  const { data: activeCombos = [] } = useQuery({
    queryKey: ["active-combos"],
    queryFn: fetchActiveCombos,
    staleTime: 5 * 60_000,
  });
  const stagedComboSavings = useMemo(() => {
    if (activeCombos.length === 0 || !product || stagedPairs.length === 0) return 0;
    // Pick the BEST single combo any staged pair unlocks. Combos
    // fire once per cart by the gate semantics, so we don't sum
    // across multiple staged pairs (would over-promise the discount).
    let best = 0;
    for (const p of stagedPairs) {
      const c = bestComboForPair({
        combos:                 activeCombos,
        currentProductId:       product.id,
        currentProductCategory: product.category,
        currentProductPrice:    product.price,
        pairProductId:          p.id,
        pairProductCategory:    p.category,
        pairProductPrice:       p.price,
        outletId,
      });
      if (c && c.savings > best) best = c.savings;
    }
    return best;
  }, [activeCombos, product, stagedPairs, outletId]);

  const grandTotal = Math.max(
    0,
    totalPrice + stagedPairsTotal - saleSavingsThisLine - stagedComboSavings,
  );
  // "items" count for the CTA: 1 for the main product (regardless of qty,
  // because qty multiplies the same line — feels weird to say "Add 5
  // items" when it's the same drink) + 1 for each staged pair.
  const itemKindsCount = 1 + stagedPairsCount;

  // Layout-shaped skeleton instead of a centered spinner — eye reads
  // the structure immediately, perceived load drops vs. a spinner
  // that just says "wait". Real content fades in over the same shape
  // when the menu fetch resolves.
  if (isLoading || !product) {
    return <ProductPageSkeleton />;
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
      // Commit any staged pair-with selections in the SAME tap. Each
      // pair lands as its own cart line at qty 1 with the product's
      // default modifier selections. Customer can still bump qty or
      // edit options from the cart row tap (cartId edit flow).
      for (const pair of stagedPairs) {
        const pairSelections: ModifierSelection[] = (pair.modifiers ?? []).flatMap((g) => {
          if (g.multiSelect) return [];
          const def = g.options.find((o) => o.isDefault) ?? g.options[0];
          if (!def) return [];
          return [{
            groupId:   g.id,
            groupName: g.name,
            optionId:  def.id,
            label:     def.label,
            priceDelta: def.priceDelta,
          }];
        });
        const pairModTotal = pairSelections.reduce((s, m) => s + m.priceDelta, 0);
        addToCart({
          productId: pair.id,
          name: pair.name,
          image: pair.image_url ?? undefined,
          category: pair.category,
          basePrice: pair.price,
          quantity: 1,
          modifiers: pairSelections,
          specialInstructions: undefined,
          totalPrice: pair.price + pairModTotal,
          isPair: true,
        });
        trackEvent("cart_add", {
          productId:   pair.id,
          productName: pair.name,
          quantity:    1,
          totalPrice:  pair.price + pairModTotal,
          hasNotes:    false,
          outletId,
          source:      "pair_with",
          pairedWith:  product.id,
        });
      }
    }
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        ref={scrollRef}
        onLayout={(e) => { scrollViewH.current = e.nativeEvent.layout.height; }}
        // Dynamic bottom padding — big enough to clear the absolute
        // Add-to-Cart bar when the keyboard is closed (~120px), then
        // collapses to a small breathing space when the keyboard is
        // up (the bar is hidden anyway). Stops the customer from
        // scrolling into a giant empty zone past the actual content,
        // matching the bounded-scroll feel of Grab/Foodpanda's
        // product modal.
        contentContainerStyle={{ paddingBottom: keyboardOpen ? 40 : 120 }}
        stickyHeaderIndices={[]}
        automaticallyAdjustKeyboardInsets
        automaticallyAdjustsScrollIndicatorInsets
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero — ProductImage handles the loading state (cream pulse +
            delayed spinner + fade-in) so the page renders complete-
            looking immediately, with the image arriving smoothly. The
            Cloudinary width-scale transform keeps the source aspect
            ratio while serving a screen-sized WebP. */}
        <ProductImage
          uri={cloudinaryThumb(product.image_url, { width: 500 })}
          width={screenW}
          height={screenH * 0.5}
        />
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
        <View
          className="bg-background -mt-6 rounded-t-2xl pt-6 px-5"
          onLayout={(e) => { bodyY.current = e.nativeEvent.layout.y; }}
        >
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
          <View className="mt-3">
            <PriceTag
              basePrice={product.price}
              sale={productSale}
              size="lg"
              inline
            />
          </View>

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
            onLayout={(e) => { noteY.current = e.nativeEvent.layout.y; noteH.current = e.nativeEvent.layout.height; }}
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
              inputAccessoryViewID={Platform.OS === "ios" ? notesAccessoryId : undefined}
              style={{
                marginTop: 8,
                backgroundColor: "#FAF7F2",
                borderWidth: 1,
                borderColor: noteFocused ? "#A2492C" : "rgba(26,8,0,0.10)",
                borderRadius: 16,
                paddingHorizontal: 14,
                paddingTop: 12,
                paddingBottom: 12,
                fontSize: 14,
                color: "#160800",
                fontFamily: "SpaceGrotesk_400Regular",
                minHeight: 92,
              }}
              // Scroll-into-view is handled by the keyboard effect above
              // (fires once the keyboard inset has settled), not here —
              // an inline scroll runs before the inset applies and clamps
              // short, leaving the box half-hidden.
              onFocus={() => setNoteFocused(true)}
              onBlur={() => setNoteFocused(false)}
            />
            {/* iOS keyboard toolbar — a "Done" button so the customer can
                dismiss the keyboard from a multiline field (return inserts
                a newline here, so it can't double as Done). */}
            {Platform.OS === "ios" && (
              <InputAccessoryView nativeID={notesAccessoryId}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    backgroundColor: "#F7F4EF",
                    borderTopWidth: 1,
                    borderTopColor: "rgba(26,8,0,0.10)",
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                  }}
                >
                  <Pressable
                    onPress={() => Keyboard.dismiss()}
                    hitSlop={10}
                    className="active:opacity-60"
                    accessibilityRole="button"
                    accessibilityLabel="Done editing instructions"
                  >
                    <Text
                      style={{
                        color: "#A2492C",
                        fontFamily: "SpaceGrotesk_700Bold",
                        fontSize: 16,
                      }}
                    >
                      Done
                    </Text>
                  </Pressable>
                </View>
              </InputAccessoryView>
            )}
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

          {/* Pair-with cross-sell. Sits at the BOTTOM of the scroll
              content (after the customer has configured their drink)
              so the suggestion lands at the moment of decision —
              right before they look at the Add to cart bar. Hidden in
              edit mode because that flow is "fix this existing line",
              not "buy more"; surfacing cross-sell there is confusing.
              Tapping a pair stages it; main CTA below commits the
              drink + every staged pair in one shot. */}
          {!isEditing && (
            <PairWith
              current={product}
              allProducts={data?.products ?? []}
              stagedIds={stagedPairIds}
              onToggle={togglePair}
            />
          )}
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
          accessibilityLabel={`${
            isEditing ? "Update cart" : (
              itemKindsCount > 1
                ? `Add ${itemKindsCount} items to cart`
                : "Add to cart"
            )
          }, ${formatPrice(grandTotal)}`}
          accessibilityState={{ disabled: !allRequiredPicked }}
        >
          {allRequiredPicked ? (
            <>
              <Text className="text-white font-bold text-base">
                {isEditing
                  ? "Update cart"
                  : (itemKindsCount > 1 ? `Add ${itemKindsCount} items` : "Add to cart")}
              </Text>
              <Text className="text-white font-bold text-base">·</Text>
              <Text className="text-white font-bold text-base">{formatPrice(grandTotal)}</Text>
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
