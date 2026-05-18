// Web-specific Menu UX. Refers to the previous Next.js implementation:
// instead of the native scroll-spy + auto-scrolling sidebar pattern,
// the web version uses filter-by-click — sidebar pills are filters,
// the product list shows only the active category. No section offset
// tracking, no scroll lock, no sidebar auto-scroll. Cleaner mouse +
// desktop UX, matches what the old apps/order Next.js page did.

import { Fragment, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  TextInput,
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
} from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fetchMenu, type Product } from "../lib/menu";
import { useApp, cartCount, cartTotal } from "../lib/store";
import { formatPrice } from "../lib/api";
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

const HIDDEN_CATEGORIES = new Set(["bottles"]);

export default function MenuWeb() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const phone = useApp((s) => s.phone);
  const cart = useApp((s) => s.cart);
  const addToCart = useApp((s) => s.addToCart);
  const outletId = useApp((s) => s.outletId);
  const outletName = useApp((s) => s.outletName);

  const { data, isLoading } = useQuery({
    queryKey: ["menu", outletId ?? "no-outlet"],
    queryFn: () => fetchMenu(outletId),
    staleTime: 60_000,
  });

  const recent = useQuery({
    queryKey: ["recent-items", phone ?? "anon"],
    queryFn: () => (phone ? fetchRecentItems(phone, 12) : Promise.resolve([])),
    enabled: !!phone,
    staleTime: 5 * 60_000,
  });

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState<Record<string, boolean>>({});

  const visibleCats = useMemo(
    () => (data?.categories ?? []).filter((c) => !HIDDEN_CATEGORIES.has(c.id)),
    [data],
  );

  const bestSellers = useMemo(() => {
    if (!data) return [];
    return data.products
      .filter(
        (p) =>
          p.is_featured && p.is_available && !HIDDEN_CATEGORIES.has(p.category),
      )
      .slice()
      .sort(
        (a, b) =>
          (a.featured_position ?? 9999) - (b.featured_position ?? 9999) ||
          a.name.localeCompare(b.name),
      );
  }, [data]);
  const hasBestSellers = bestSellers.length > 0;

  const usualProducts = useMemo(() => {
    if (!data || !recent.data) return [];
    return recent.data
      .map((r) => data.products.find((p) => p.id === r.id))
      .filter((p): p is Product => !!p && p.is_available && !HIDDEN_CATEGORIES.has(p.category))
      .slice(0, 8);
  }, [data, recent.data]);
  const hasUsual = !!phone && usualProducts.length > 0;

  const initialActive =
    params.tab === "usual" && hasUsual
      ? USUAL_ID
      : hasUsual
      ? USUAL_ID
      : hasBestSellers
      ? BEST_SELLERS_ID
      : visibleCats[0]?.id ?? "";
  const [activeCategory, setActiveCategory] = useState(initialActive);

  // Promote the initial value once everything's loaded — `initialActive`
  // is computed eagerly so it can run before the data resolves. Once
  // best-sellers / usual / categories are known, sync the state if it
  // would otherwise be empty (first render before data).
  useMemo(() => {
    if (!activeCategory && initialActive) setActiveCategory(initialActive);
  }, [activeCategory, initialActive]);

  const productsForActive = useMemo(() => {
    if (!data) return [];
    if (query) {
      return data.products.filter(
        (p) =>
          p.is_available &&
          !HIDDEN_CATEGORIES.has(p.category) &&
          p.name.toLowerCase().includes(query.toLowerCase()),
      );
    }
    if (activeCategory === USUAL_ID) return usualProducts;
    if (activeCategory === BEST_SELLERS_ID) return bestSellers;
    return data.products.filter(
      (p) => p.is_available && p.category === activeCategory,
    );
  }, [data, query, activeCategory, usualProducts, bestSellers]);

  const activeLabel = useMemo(() => {
    if (query) return null;
    if (activeCategory === USUAL_ID) return "Your usual";
    if (activeCategory === BEST_SELLERS_ID) return "Best Sellers";
    return visibleCats.find((c) => c.id === activeCategory)?.name ?? "";
  }, [activeCategory, visibleCats, query]);

  const onPressPill = (id: string) => {
    Haptics.selectionAsync();
    setActiveCategory(id);
  };

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
    setTimeout(() => setRecentlyAdded((s) => ({ ...s, [p.id]: false })), 900);
  };

  if (isLoading || !data) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <Stack.Screen options={{ headerShown: false }} />
        <CelsiusLoader />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header — pickup outlet + search + cart */}
      <View
        className="bg-surface border-b border-border"
        style={{ paddingTop: insets.top }}
      >
        <View className="flex-row items-center gap-3 px-4 pt-2 pb-2">
          {searchOpen ? (
            <View className="flex-1 flex-row items-center gap-2 bg-background rounded-full px-3 py-2">
              <Search size={16} color="#6E6E73" />
              <TextInput
                autoFocus
                placeholder="Search menu…"
                value={query}
                onChangeText={setQuery}
                style={{
                  flex: 1,
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 14,
                  color: "#160800",
                  ...({ outline: "none" } as object),
                }}
              />
              {query.length > 0 && (
                <Pressable
                  onPress={() => setQuery("")}
                  hitSlop={8}
                  accessibilityLabel="Clear search"
                >
                  <X size={16} color="#6E6E73" />
                </Pressable>
              )}
            </View>
          ) : (
            <Text
              className="flex-1 text-espresso text-[22px]"
              style={{ fontFamily: "Peachi-Bold", letterSpacing: -0.5 }}
            >
              Menu
            </Text>
          )}

          <Pressable
            onPress={() => {
              if (searchOpen) setQuery("");
              setSearchOpen((v) => !v);
            }}
            hitSlop={8}
            accessibilityLabel={searchOpen ? "Cancel search" : "Open search"}
            className="px-1"
          >
            {searchOpen ? (
              <Text
                className="text-primary text-[14px]"
                style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
              >
                Cancel
              </Text>
            ) : (
              <Search size={20} color="#6E6E73" />
            )}
          </Pressable>

          <Pressable
            onPress={() => router.push("/cart")}
            hitSlop={8}
            accessibilityLabel="Cart"
            className="relative px-1"
          >
            <ShoppingCart size={20} color="#160800" />
            {cartCount(cart) > 0 && (
              <View
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  minWidth: 14,
                  height: 14,
                  paddingHorizontal: 3,
                  borderRadius: 7,
                  backgroundColor: "#C05040",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 9,
                    lineHeight: 11,
                  }}
                >
                  {cartCount(cart)}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Outlet selector */}
        <Pressable
          onPress={() => router.push({ pathname: "/store", params: { next: "menu" } as any })}
          className="flex-row items-center gap-2 px-4 pb-3 active:opacity-70"
          accessibilityLabel="Change pickup outlet"
        >
          <MapPin size={14} color="#C05040" />
          <Text
            className="flex-1 text-espresso text-[13px]"
            style={{ fontFamily: "SpaceGrotesk_600SemiBold" }}
            numberOfLines={1}
          >
            {outletName ?? "Select pickup outlet"}
          </Text>
          <ChevronDown size={14} color="#6E6E73" />
        </Pressable>
      </View>

      <ReservedVoucherBanner />

      {/* Body — sidebar + filtered product list */}
      <View className="flex-1 flex-row">
        {/* Sidebar (only when not searching) */}
        {!query && (
          <ScrollView
            className="bg-surface border-r border-border"
            style={{ width: 80, flexShrink: 0 }}
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
          >
            {hasUsual && (
              <CatPill
                active={activeCategory === USUAL_ID}
                onPress={() => onPressPill(USUAL_ID)}
                icon={Heart}
                label="Usual"
                fill={activeCategory === USUAL_ID}
              />
            )}
            {hasBestSellers && (
              <CatPill
                active={activeCategory === BEST_SELLERS_ID}
                onPress={() => onPressPill(BEST_SELLERS_ID)}
                icon={Star}
                label="Best Sellers"
                fill={activeCategory === BEST_SELLERS_ID}
              />
            )}
            {visibleCats.map((c) => {
              const Icon = CAT_ICON[c.id] ?? Coffee;
              return (
                <CatPill
                  key={c.id}
                  active={activeCategory === c.id}
                  onPress={() => onPressPill(c.id)}
                  icon={Icon}
                  label={c.name}
                />
              );
            })}
          </ScrollView>
        )}

        {/* Product list (filtered to active category, or search results) */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 180 }}
          showsVerticalScrollIndicator={false}
        >
          {query ? (
            <Fragment>
              <Text
                className="text-muted-fg text-xs px-4 pt-3 pb-1"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              >
                {productsForActive.length} result
                {productsForActive.length !== 1 ? "s" : ""} for "{query}"
              </Text>
              <View className="px-3 pt-2 gap-3">
                {productsForActive.length === 0 && (
                  <View className="py-12 items-center">
                    <Text
                      className="text-muted-fg text-sm"
                      style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    >
                      No matches
                    </Text>
                  </View>
                )}
                {productsForActive.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onAdd={() => addSimple(p)}
                    recentlyAdded={!!recentlyAdded[p.id]}
                  />
                ))}
              </View>
            </Fragment>
          ) : (
            <Fragment>
              {/* Category header */}
              <View className="px-4 pt-3 pb-2 border-b border-border bg-surface/60 flex-row items-center justify-between">
                <Text
                  className="text-espresso text-[16px]"
                  style={{ fontFamily: "Peachi-Bold", letterSpacing: -0.2 }}
                >
                  {activeLabel}
                </Text>
                <Text
                  className="text-muted-fg text-[11px]"
                  style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 0.5 }}
                >
                  {productsForActive.length}
                </Text>
              </View>

              <View className="px-3 pt-3 gap-3">
                {productsForActive.length === 0 && (
                  <View className="py-12 items-center">
                    <Text
                      className="text-muted-fg text-sm"
                      style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                    >
                      Nothing in this category yet
                    </Text>
                  </View>
                )}
                {productsForActive.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onAdd={() => addSimple(p)}
                    recentlyAdded={!!recentlyAdded[p.id]}
                  />
                ))}
              </View>
            </Fragment>
          )}
        </ScrollView>
      </View>

      {cartCount(cart) > 0 && (
        <CartPill
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

// ────────────────────────────────────────────────────────────────────

function CatPill({
  active,
  onPress,
  icon: Icon,
  label,
  fill = false,
}: {
  active: boolean;
  onPress: () => void;
  icon: any;
  label: string;
  fill?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={{
        width: 80,
        paddingTop: 12,
        paddingBottom: 12,
        paddingHorizontal: 4,
        alignItems: "center",
        gap: 6,
        borderLeftWidth: 3,
        borderLeftColor: active ? "#C05040" : "transparent",
        backgroundColor: active ? "#FFFFFF" : "transparent",
      }}
      className="active:opacity-70"
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? "rgba(192,80,64,0.10)" : "rgba(0,0,0,0.04)",
        }}
      >
        <Icon
          size={20}
          color={active ? "#C05040" : "#6E6E73"}
          strokeWidth={1.75}
          fill={fill && active ? "#C05040" : "transparent"}
        />
      </View>
      <Text
        style={{
          fontFamily: active ? "SpaceGrotesk_700Bold" : "SpaceGrotesk_500Medium",
          fontSize: 10,
          lineHeight: 12,
          textAlign: "center",
          color: active ? "#C05040" : "#6E6E73",
        }}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function ProductCard({
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
    () =>
      bestSaleForProduct({
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
            className="text-espresso text-[14px]"
            style={{ fontFamily: "Peachi-Bold" }}
            numberOfLines={1}
            ellipsizeMode="tail"
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

function CartPill({
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
  // Web pill — same portalled fixed-position pattern as MenuCartFloatingBar
  // in menu.tsx. Sits above the bottom nav and stays put while content
  // scrolls. iOS Safari standalone PWA gets correct anchoring because
  // there's no React Native View ancestor between the portal child and
  // <body>.
  const bar = (
    <View
      style={{
        position: "fixed" as unknown as "absolute",
        bottom:
          "calc(env(safe-area-inset-bottom, 0px) + 80px)" as unknown as number,
        left: 16,
        right: 16,
        zIndex: 99,
      }}
    >
      <Pressable
        onPress={onPress}
        className="bg-primary rounded-full py-3 px-5 flex-row items-center justify-between active:opacity-80"
        style={{
          shadowColor: "#C05040",
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

  if (typeof document !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createPortal } = require("react-dom") as typeof import("react-dom");
    return createPortal(bar, document.body);
  }
  return bar;
}
