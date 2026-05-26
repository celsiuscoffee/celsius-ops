import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Platform,
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  TextInput,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type LayoutChangeEvent,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "@/lib/haptics";
import {
  Search,
  ShoppingCart,
  ChevronDown,
  X,
  MapPin,
  Coffee,
  Leaf,
  Cake,
  Cookie,
  Croissant,
  Sandwich,
  Candy,
  CupSoda,
  Cherry,
  Sparkles,
  Wheat,
  UtensilsCrossed,
  Utensils,
  FlaskConical,
  Star,
  Plus,
  Check,
  Heart,
  ChevronRight,
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMenu, type Product } from "../lib/menu";
import { useApp, cartCount, cartTotal } from "../lib/store";
import { formatPrice } from "../lib/api";
import { EspressoHeader } from "../components/EspressoHeader";
import { cloudinaryThumb } from "../lib/image";
import { useActiveSales } from "../lib/use-active-sales";
import { bestSaleForProduct } from "../lib/product-sales";
import { PriceTag } from "../components/PriceTag";
import { BottomNav } from "../components/BottomNav";
import { ReservedVoucherBanner } from "../components/ReservedVoucherBanner";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { ProductImage } from "../components/ProductImage";
import { fetchRecentItems } from "../lib/rewards";

const BEST_SELLERS_ID = "__best_sellers__";
const USUAL_ID = "__usual__";

const CAT_ICON: Record<string, any> = {
  "artisan-choc": Candy,
  "artisan-matcha": Leaf,
  cakes: Cake,
  classic: Coffee,
  cookies: Cookie,
  croissant: Croissant,
  flavoured: FlaskConical,
  fries: Utensils,
  "fruit-tea": Cherry,
  "gourmet-tea": Sparkles,
  mocha: Coffee,
  mocktails: CupSoda,
  "nasi-lemak": UtensilsCrossed,
  noodle: UtensilsCrossed,
  pasta: UtensilsCrossed,
  "roti-bakar": Wheat,
  sandwiches: Sandwich,
};

// Bottles are an upsell rack at the counter — not a real app product.
// Nasi Lemak / Noodles / Pasta / Roti Bakar were previously hidden on
// the assumption that hot rice / pasta / toast don't survive the 5-15
// min pickup window well, but the product call was reversed: customers
// expect a full menu, and ETA-based reheating instructions can be added
// later if quality complaints surface. Show them in the Food group.
const HIDDEN_CATEGORIES = new Set([
  "bottles",
]);

export default function Menu() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  // Web PWA viewport budget is tight (especially iOS Safari with its
  // ~50px URL bar eating into vph). Narrow the sidebar and trim some
  // generous bottom padding so the product list has more room to breathe.
  // Native keeps the spacious defaults — phones have a full viewport.
  const { width: viewportWidth } = useWindowDimensions();
  const isWeb = Platform.OS === "web";
  const isNarrowWeb = isWeb && viewportWidth < 420;
  const sidebarWidth = isNarrowWeb ? 60 : 80;
  const pillWidth = isNarrowWeb ? 52 : 72;
  const productListBottomPadClass = isWeb ? "pb-32" : "pb-44";
  const cart = useApp((s) => s.cart);
  const outletName = useApp((s) => s.outletName);
  const outletId = useApp((s) => s.outletId);
  // Menu is keyed by outlet so per-outlet OOS overrides land — switching
  // outlets (or signing in to an outlet for the first time) refetches
  // and applies that outlet's OOS list.
  const { data, isLoading } = useQuery({
    queryKey: ["menu", outletId],
    queryFn: () => fetchMenu(outletId),
  });
  const addToCart = useApp((s) => s.addToCart);
  const phone = useApp((s) => s.phone);

  // Force outlet pick before showing the menu. Without this, customers
  // could shop the whole menu, hit checkout, and only THEN learn they
  // haven't selected an outlet — high abandon point. Redirect to /store
  // with a return-to-menu hint so the next pick lands them straight here.
  // Uses replace so the back stack doesn't grow a Menu→Store→Menu loop.
  useEffect(() => {
    if (!outletId) {
      router.replace({ pathname: "/store", params: { next: "menu" } });
    }
  }, [outletId]);

  // Recent items power the "Usual" pill — loaded only for signed-in users.
  // Cached for 60s so coming back from a product detail doesn't refetch.
  const recent = useQuery({
    queryKey: ["recent-items", phone],
    queryFn: () => (phone ? fetchRecentItems(phone, 12) : Promise.resolve([])),
    enabled: !!phone,
    staleTime: 60_000,
  });
  const hasUsual = !!phone && (recent.data?.length ?? 0) > 0;

  // Customer-driven section selection (set by scroll-spy or pill tap).
  // null = "follow the natural top-of-list" — the derived `active`
  // below picks sections[0] in that case so the pill highlight always
  // matches the visible top section, including across the moment when
  // recent items load and Usual gets prepended. The `?tab=usual` deep
  // link is honored as an explicit override since the customer asked
  // for that tab specifically.
  const [activeOverride, setActiveOverride] = useState<string | null>(
    params.tab === "usual" ? USUAL_ID : null,
  );
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState<Record<string, boolean>>({});

  // Categories arrive from the menu API already ordered by their
  // backoffice-managed `position`. Just drop the hidden ones.
  const visibleCats = useMemo(
    () => (data?.categories ?? []).filter((c) => !HIDDEN_CATEGORIES.has(c.id)),
    [data]
  );
  // Best Sellers + search results need the same hidden-category filter
  // so dine-in products don't sneak in via the Best Sellers tab or a
  // free-text search. Otherwise hiding categories was cosmetic.
  const bestSellers = useMemo(
    () =>
      (data?.products ?? [])
        .filter(
          (p) =>
            p.is_featured && p.is_available && !HIDDEN_CATEGORIES.has(p.category),
        )
        .slice()
        .sort((a, b) =>
          (a.featured_position ?? 9999) - (b.featured_position ?? 9999)
          || a.name.localeCompare(b.name)
        ),
    [data]
  );
  const hasBestSellers = bestSellers.length > 0;

  // Resolve recent items back to full Product records so the Usual tab uses
  // the same ProductRow rendering (with modifiers, description, etc.) as
  // every other category. Order preserved by recent.data ordering.
  const usualProducts = useMemo(() => {
    if (!data || !recent.data) return [];
    const byId = new Map(data.products.map((p) => [p.id, p]));
    return recent.data
      .map((r) => byId.get(r.id))
      .filter((p): p is Product => !!p && p.is_available);
  }, [data, recent.data]);

  // `filtered` only feeds the search-results panel — the stacked
  // sections render path uses `sections` directly. Previously this
  // memo also handled the active-section case, but that branch was
  // dead (the stacked render doesn't read `filtered`) and now creates
  // a temporal-dead-zone problem because `active` is derived from
  // `sections` further down. Search-only keeps the dependency list
  // clean.
  const filtered = useMemo(() => {
    if (!data || !query) return [];
    const q = query.toLowerCase();
    return data.products.filter(
      (p) =>
        p.is_available &&
        !HIDDEN_CATEGORIES.has(p.category) &&
        p.name.toLowerCase().includes(q),
    );
  }, [data, query]);

  // ─── Linked-scroll sections ────────────────────────────────────────
  //
  // When no search is active, the right column renders ALL categories
  // stacked vertically with headers. Scrolling syncs the active sidebar
  // pill (Luckin / ZUS pattern). Tapping a pill scrolls to that section.
  //
  // Sections are computed in render order: Usual → Best Sellers → real
  // categories from the menu, each filtered to available + hidden-cat-safe.
  type MenuSection = {
    id: string;
    label: string;
    icon: keyof typeof CAT_ICON | typeof BEST_SELLERS_ID | typeof USUAL_ID;
    products: Product[];
  };

  const sections: MenuSection[] = useMemo(() => {
    if (!data || query) return [];
    const out: MenuSection[] = [];
    if (hasUsual)
      out.push({ id: USUAL_ID,        label: "Your usual",  icon: USUAL_ID,        products: usualProducts });
    if (hasBestSellers)
      out.push({ id: BEST_SELLERS_ID, label: "Best Sellers", icon: BEST_SELLERS_ID, products: bestSellers });
    for (const c of visibleCats) {
      const products = data.products.filter((p) => p.is_available && p.category === c.id);
      if (products.length === 0) continue;
      out.push({ id: c.id, label: c.name, icon: c.id as keyof typeof CAT_ICON, products });
    }
    return out;
  }, [data, query, hasUsual, hasBestSellers, usualProducts, bestSellers, visibleCats]);

  // y-offset of each section's TOP within the right ScrollView's content.
  // Captured via onLayout so we can scroll to any section by id, and so
  // the scroll listener can decide which section is currently visible.
  const sectionOffsets = useRef<Record<string, number>>({});
  const setSectionOffset = useCallback((id: string) => (e: LayoutChangeEvent) => {
    sectionOffsets.current[id] = e.nativeEvent.layout.y;
  }, []);

  // Programmatic-scroll guard. After a sidebar pill tap we kick off an
  // animated scrollTo; during that animation onScroll fires constantly
  // and would race with our setActive. Lock the listener for ~400ms
  // so the user-intent pick wins.
  const scrollLockUntil = useRef<number>(0);
  const productListRef = useRef<ScrollView | null>(null);
  const sidebarRef = useRef<ScrollView | null>(null);
  // Track the last seen scroll y so effects that re-evaluate the
  // active section (e.g. when sections change after recent items
  // load) can use the current scroll position without waiting for
  // the next onScroll event.
  const lastScrollY = useRef(0);
  // Track sidebar pill y-offsets so we can keep the active one in view
  // when the user scrolls the product list (auto-scroll the sidebar).
  const pillOffsets = useRef<Record<string, number>>({});
  const setPillOffset = useCallback((id: string) => (e: LayoutChangeEvent) => {
    pillOffsets.current[id] = e.nativeEvent.layout.y;
  }, []);

  /** Pick the section whose top is at or above (y + 64). */
  const computeActiveAt = useCallback(
    (y: number): string | undefined => {
      const threshold = y + 64;
      let current = sections[0]?.id;
      for (const s of sections) {
        const off = sectionOffsets.current[s.id];
        // Skip sections that haven't been measured yet — using a
        // missing offset as 0 would falsely promote the not-yet-laid-
        // out section to "active" the moment sections changes.
        if (off === undefined) continue;
        if (off <= threshold) current = s.id;
        else break;
      }
      return current;
    },
    [sections],
  );

  // Derived active section. Uses the customer's override when set
  // (scroll-spy or pill tap); otherwise falls back to sections[0]
  // so the pill always reflects the natural top of the list. This
  // is what kills the "Best Sellers flashes then jumps to Usual"
  // bug — the override stays null until the customer scrolls or
  // taps, so the highlight just smoothly tracks whatever section
  // is at the top after queries resolve.
  const active = activeOverride ?? sections[0]?.id ?? "";

  const onProductScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Date.now() < scrollLockUntil.current) return;
      const y = e.nativeEvent.contentOffset.y;
      lastScrollY.current = y;
      const current = computeActiveAt(y);
      if (current && current !== active) {
        setActiveOverride(current);
      }
    },
    [computeActiveAt, active],
  );

  // Keep the active pill in view in the sidebar — when the product
  // list auto-changes the active section, scroll the sidebar to centre
  // that pill so the user can see context.
  useEffect(() => {
    const off = pillOffsets.current[active];
    if (off === undefined) return;
    sidebarRef.current?.scrollTo({ y: Math.max(0, off - 120), animated: true });
  }, [active]);

  const onPressPill = useCallback(
    (id: string) => {
      Haptics.selectionAsync();
      setActiveOverride(id);
      const y = sectionOffsets.current[id];
      if (y !== undefined) {
        scrollLockUntil.current = Date.now() + 450;
        productListRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
      }
    },
    [],
  );

  const addSimple = (p: Product) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addToCart({
      productId: p.id,
      name: p.name,
      image: p.image_url ?? undefined,
      category: p.category,
      basePrice: p.price,
      quantity: 1,
      modifiers: [],
      specialInstructions: undefined,
      totalPrice: p.price,
    });
    setRecentlyAdded((s) => ({ ...s, [p.id]: true }));
    setTimeout(
      () => setRecentlyAdded((s) => ({ ...s, [p.id]: false })),
      1000
    );
  };

  // Wait for the recent-items query too on signed-in users — without
  // this, "Best Sellers" gets the highlight on first paint (sections
  // = [BestSellers, ...categories]) and then snaps to "Your usual" a
  // moment later when recent loads and Usual gets prepended. Holding
  // the loader until both queries settle gives a clean first paint
  // where the right pill is highlighted from the start.
  //
  // For guest users (no phone), recent.isPending is still true (the
  // query is `enabled: false` so it never starts), so we gate on
  // `!!phone` to avoid blocking guests forever.
  const recentSettling = !!phone && recent.isPending;
  if (isLoading || !data || recentSettling) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <CelsiusLoader size="md" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Standardised espresso header — matches every other page
          (Order detail, Account, Settings, etc.). Search swaps the
          title for an inline white-tinted search field; the cart
          icon stays put in the right slot. Outlet picker drops to a
          surface row directly under the header so it still reads as
          one piece of chrome. */}
      {searchOpen ? (
        <View
          className="bg-espresso px-4"
          style={{ paddingTop: insets.top + 8, paddingBottom: 12 }}
        >
          <View className="flex-row items-center gap-3">
            <View className="flex-1 flex-row items-center gap-2 rounded-full px-3 py-2" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
              <Search size={16} color="rgba(255,255,255,0.7)" />
              <TextInput
                autoFocus
                placeholder="Search menu…"
                placeholderTextColor="rgba(255,255,255,0.5)"
                value={query}
                onChangeText={setQuery}
                className="flex-1 text-white text-sm"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery("")} hitSlop={12}>
                  <X size={16} color="rgba(255,255,255,0.7)" />
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setSearchOpen(false);
                setQuery("");
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <Text className="text-white text-sm font-medium">Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <EspressoHeader
          title="Pickup"
          showCart={false}
          rightSlot={
            <View className="flex-row items-center gap-4">
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setSearchOpen(true);
                }}
                className="p-1 active:opacity-60"
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Search menu"
              >
                <Search size={20} color="rgba(255,255,255,0.85)" />
              </Pressable>
              <Pressable
                onPress={() => router.push("/cart")}
                className="p-1 relative active:opacity-60"
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={
                  cartCount(cart) > 0
                    ? `Cart, ${cartCount(cart)} ${cartCount(cart) === 1 ? "item" : "items"}`
                    : "Cart, empty"
                }
              >
                <ShoppingCart size={20} color="rgba(255,255,255,0.85)" />
                {cartCount(cart) > 0 && (
                  <View className="absolute -top-0.5 -right-0.5 bg-white rounded-full w-4 h-4 items-center justify-center">
                    <Text className="text-primary text-[9px] font-bold">{cartCount(cart)}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          }
        />
      )}

      {/* Outlet picker — surface row beneath the espresso header so it
          reads as the secondary chrome row, like the cart's "Slide to
          confirm" surface or the order page's pickup-details row.
          Web compresses py-3 -> py-2: the customer's browser viewport
          is shorter than a native phone (URL bar + browser UI) so every
          row of chrome we save lets one more product peek above the
          fold. */}
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/store");
        }}
        className={`bg-surface flex-row items-center gap-2 px-4 ${isWeb ? "py-2" : "py-3"} border-b border-border active:opacity-70`}
        accessibilityLabel={`Pickup outlet: ${outletName ?? "not selected"}. Tap to change.`}
      >
        <MapPin size={14} color="#A2492C" />
        <Text className="text-espresso font-bold text-sm flex-1" numberOfLines={1}>
          {outletName ?? "Select outlet"}
        </Text>
        <ChevronDown size={14} color="#8E8E93" />
      </Pressable>

        {/* Guest banner — gentle pull to sign in. Sits below the outlet
            row so it never blocks the cart icon. Only shown when the
            user isn't signed in yet. */}
        {!phone && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/account");
            }}
            className="active:opacity-90"
            style={{ backgroundColor: "#1A0200" }}
          >
            <View className="flex-row items-center justify-between px-4 py-2.5">
              <View className="flex-row items-center gap-2 flex-1">
                <Text style={{ fontSize: 14 }}>🎁</Text>
                <Text
                  className="text-white text-[12px] flex-1"
                  style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
                  numberOfLines={1}
                >
                  Sign in for a free welcome drink
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text
                  className="text-amber-400 text-[11px] uppercase"
                  style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 1 }}
                >
                  Sign in
                </Text>
                <ChevronRight size={12} color="#FBBF24" />
              </View>
            </View>
          </Pressable>
        )}

      <ReservedVoucherBanner />

      {/* Side category pills + product list */}
      <View className="flex-1 flex-row">
        {!query && (
          <View
            className="bg-surface border-r border-border"
            style={{ width: sidebarWidth, flexShrink: 0 }}
          >
          <ScrollView
            ref={sidebarRef}
            style={{ flex: 1, width: sidebarWidth }}
            contentContainerStyle={{ width: sidebarWidth, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 180, gap: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {/* "Usual" sits above Best Sellers because retention beats discovery
                — once a customer has a regular order, that's the fastest path
                back to the cart. Only renders for signed-in users with history. */}
            {hasUsual && (
              <View onLayout={setPillOffset(USUAL_ID)}>
                <SideCategoryPill
                  active={active === USUAL_ID}
                  onPress={() => onPressPill(USUAL_ID)}
                  icon={Heart}
                  label="Usual"
                  fill={active === USUAL_ID}
                  width={pillWidth}
                />
              </View>
            )}
            {hasBestSellers && (
              <View onLayout={setPillOffset(BEST_SELLERS_ID)}>
                <SideCategoryPill
                  active={active === BEST_SELLERS_ID}
                  onPress={() => onPressPill(BEST_SELLERS_ID)}
                  icon={Star}
                  label="Best Sellers"
                  fill={active === BEST_SELLERS_ID}
                  width={pillWidth}
                />
              </View>
            )}
            {visibleCats.map((c) => {
              const Icon = CAT_ICON[c.id] ?? Coffee;
              return (
                <View key={c.id} onLayout={setPillOffset(c.id)}>
                  <SideCategoryPill
                    active={active === c.id}
                    onPress={() => onPressPill(c.id)}
                    icon={Icon}
                    label={c.name}
                    width={pillWidth}
                  />
                </View>
              );
            })}
          </ScrollView>
          </View>
        )}

        <ScrollView
          ref={productListRef}
          className="flex-1"
          contentContainerClassName={productListBottomPadClass}
          showsVerticalScrollIndicator={false}
          onScroll={onProductScroll}
          scrollEventThrottle={16}
        >
          {query ? (
            <>
              <Text
                className="text-muted-fg text-xs px-4 pt-3 pb-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{query}"
              </Text>
              <View className="px-3 pt-3 gap-3">
                {filtered.length === 0 && (
                  <View className="py-12 items-center">
                    <Text
                      className="text-muted-fg text-sm"
                      style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    >
                      No matches
                    </Text>
                  </View>
                )}
                {filtered.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onAdd={() => addSimple(p)}
                    recentlyAdded={!!recentlyAdded[p.id]}
                  />
                ))}
              </View>
            </>
          ) : (
            // Stacked sections — scroll auto-syncs the sidebar pill.
            sections.length === 0 ? (
              <View className="py-12 items-center">
                <Text
                  className="text-muted-fg text-sm"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  No products available right now
                </Text>
              </View>
            ) : (
              sections.map((s) => (
                <View key={s.id} onLayout={setSectionOffset(s.id)} className="px-3 pt-4">
                  <View className="flex-row items-center mb-2 px-1">
                    <Text
                      className="text-espresso text-[20px] flex-1"
                      style={{ fontFamily: "Peachi-Bold", letterSpacing: -0.3 }}
                    >
                      {s.label}
                    </Text>
                    <Text
                      className="text-muted-fg text-[11px]"
                      style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }}
                    >
                      {s.products.length}
                    </Text>
                  </View>
                  <View style={{ gap: 12 }}>
                    {s.products.map((p) => (
                      <ProductRow
                        key={p.id}
                        product={p}
                        onAdd={() => addSimple(p)}
                        recentlyAdded={!!recentlyAdded[p.id]}
                      />
                    ))}
                  </View>
                </View>
              ))
            )
          )}
        </ScrollView>
      </View>

      {/* Cart pill — sits above bottom nav */}
      {cartCount(cart) > 0 && (
        <MenuCartFloatingBar
          count={cartCount(cart)}
          priceLabel={formatPrice(cartTotal(cart))}
          insetBottom={insets.bottom}
          onPress={() => router.push("/cart")}
        />
      )}

      <BottomNav />
    </View>
  );
}

// Floating cart pill — same pattern as the home screen's ViewCart bar.
// Portals to <body> + position:fixed on web so it pins to the viewport
// over the body-scroll layout. Native keeps in-tree absolute.
function MenuCartFloatingBar({
  count,
  priceLabel,
  insetBottom,
  onPress,
}: {
  count: number;
  priceLabel: string;
  insetBottom: number;
  onPress: () => void;
}) {
  const isWeb = Platform.OS === "web";
  const webOverrides = isWeb
    ? ({
        position: "fixed" as unknown as "absolute",
        bottom:
          "calc(env(safe-area-inset-bottom, 0px) + 80px)" as unknown as number,
        left: 16,
        right: 16,
        zIndex: 99,
      } as const)
    : null;

  const bar = (
    <View
      className="absolute left-4 right-4"
      style={{
        bottom: insetBottom + 70,
        ...(webOverrides ?? {}),
      }}
    >
      <Pressable
        onPress={onPress}
        className="bg-primary rounded-full py-3 px-5 flex-row items-center justify-between active:opacity-80"
        style={{
          shadowColor: "#A2492C",
          shadowOpacity: 0.3,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <View className="flex-row items-center gap-2">
          <View className="bg-white rounded-full w-6 h-6 items-center justify-center">
            <Text className="text-primary text-xs font-bold">{count}</Text>
          </View>
          <Text className="text-white font-bold">View cart</Text>
        </View>
        <Text className="text-white font-bold">{priceLabel}</Text>
      </Pressable>
    </View>
  );

  if (isWeb && typeof document !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPortal } = require("react-dom") as typeof import("react-dom");
    return createPortal(bar, document.body);
  }
  return bar;
}

function SideCategoryPill({
  active,
  onPress,
  icon: Icon,
  label,
  fill = false,
  width = 72,
}: {
  active: boolean;
  onPress: () => void;
  icon: any;
  label: string;
  fill?: boolean;
  // Sidebar width override — narrow web viewports use 52 (saves
  // horizontal space alongside the 60px sidebar set in <Menu/>).
  width?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-2xl items-center justify-center gap-1 active:opacity-70 ${
        active ? "bg-espresso" : "bg-background"
      }`}
      style={{ width, height: 64, paddingHorizontal: 4 }}
    >
      <Icon
        size={16}
        color={active ? "#FFFFFF" : "#6E6E73"}
        strokeWidth={1.75}
        fill={fill && active ? "#FFFFFF" : "transparent"}
      />
      <Text
        className={`text-[9px] text-center leading-[11px] ${
          active ? "text-white" : "text-espresso"
        }`}
        style={{ fontFamily: "SpaceGrotesk_600SemiBold", width: width - 8 }}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ProductRow({
  product,
  onAdd,
  recentlyAdded,
}: {
  product: Product;
  onAdd: () => void;
  recentlyAdded: boolean;
}) {
  const hasModifiers = (product.modifiers ?? []).length > 0;
  const outletId = useApp((s) => s.outletId);
  const { sales } = useActiveSales();
  const sale = useMemo(
    () => bestSaleForProduct({
      sales,
      productId: product.id,
      productCategory: product.category,
      productBasePrice: product.price,
      outletId,
    }),
    [sales, product, outletId],
  );
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        router.push({ pathname: "/product/[id]", params: { id: product.id } });
      }}
      className="bg-surface rounded-2xl border border-border p-2.5 flex-row gap-2.5 active:opacity-70"
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <ProductImage
        uri={cloudinaryThumb(product.image_url, { size: 88 })}
        width={88}
        height={88}
        borderRadius={24}
      />
      <View className="flex-1 justify-between py-0.5 min-w-0">
        <View>
          <Text
            className="text-espresso text-[14px] leading-[18px]"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            {product.name}
          </Text>
          {product.description && (
            <Text
              className="text-muted-fg text-[11px] mt-0.5 leading-[14px]"
              style={{ fontFamily: "SpaceGrotesk_400Regular" }}
              numberOfLines={2}
            >
              {product.description}
            </Text>
          )}
        </View>
        <View className="flex-row justify-between items-center mt-1 gap-2">
          <View className="flex-1 min-w-0">
            <PriceTag basePrice={product.price} sale={sale} size="sm" />
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              if (hasModifiers) {
                router.push({ pathname: "/product/[id]", params: { id: product.id } });
              } else {
                onAdd();
              }
            }}
            hitSlop={12}
            className={`rounded-full items-center justify-center active:opacity-70 ${
              recentlyAdded ? "bg-green-600" : "bg-espresso"
            }`}
            style={{ width: 28, height: 28 }}
            accessibilityRole="button"
            accessibilityLabel={
              hasModifiers
                ? `Customise ${product.name}`
                : recentlyAdded
                ? `Added ${product.name} to cart`
                : `Add ${product.name} to cart`
            }
          >
            {recentlyAdded ? (
              <Check size={14} color="#FFFFFF" strokeWidth={3} />
            ) : (
              <Plus size={14} color="#FFFFFF" strokeWidth={2.5} />
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}
