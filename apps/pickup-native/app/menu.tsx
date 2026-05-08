import { useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Image,
  TextInput,
} from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
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
import { BottomNav } from "../components/BottomNav";
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

export default function Menu() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { data, isLoading } = useQuery({ queryKey: ["menu"], queryFn: fetchMenu });
  const cart = useApp((s) => s.cart);
  const outletName = useApp((s) => s.outletName);
  const outletId = useApp((s) => s.outletId);
  const addToCart = useApp((s) => s.addToCart);
  const phone = useApp((s) => s.phone);

  // Recent items power the "Usual" pill — loaded only for signed-in users.
  // Cached for 60s so coming back from a product detail doesn't refetch.
  const recent = useQuery({
    queryKey: ["recent-items", phone],
    queryFn: () => (phone ? fetchRecentItems(phone, 12) : Promise.resolve([])),
    enabled: !!phone,
    staleTime: 60_000,
  });
  const hasUsual = !!phone && (recent.data?.length ?? 0) > 0;

  // Default tab respects the inbound `?tab=usual` deep link from Home, falling
  // back to Best Sellers. We only honor "usual" if the user actually has one.
  const initialTab =
    params.tab === "usual" && hasUsual ? USUAL_ID : BEST_SELLERS_ID;
  const [active, setActive] = useState<string>(initialTab);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentlyAdded, setRecentlyAdded] = useState<Record<string, boolean>>({});

  const visibleCats = useMemo(
    () => (data?.categories ?? []).filter((c) => !HIDDEN_CATEGORIES.has(c.id)),
    [data]
  );
  const bestSellers = useMemo(
    () => (data?.products ?? []).filter((p) => p.is_featured && p.is_available),
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

  const filtered = useMemo(() => {
    if (!data) return [];
    if (query) {
      const q = query.toLowerCase();
      return data.products.filter(
        (p) => p.is_available && p.name.toLowerCase().includes(q)
      );
    }
    if (active === USUAL_ID) return usualProducts;
    if (active === BEST_SELLERS_ID) return bestSellers;
    return data.products.filter((p) => p.is_available && p.category === active);
  }, [data, active, query, bestSellers, usualProducts]);

  const addSimple = (p: Product) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addToCart({
      productId: p.id,
      name: p.name,
      image: p.image_url ?? undefined,
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

  if (isLoading || !data) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#C05040" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* White header with search + cart */}
      <View
        className="bg-surface border-b border-border z-10"
        style={{
          paddingTop: insets.top + 8,
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 1 },
        }}
      >
        <View className="flex-row items-center gap-3 px-4 pb-2">
          {searchOpen ? (
            <View className="flex-1 flex-row items-center gap-2 bg-background rounded-full px-3 py-2">
              <Search size={16} color="#8E8E93" />
              <TextInput
                autoFocus
                placeholder="Search menu…"
                placeholderTextColor="#8E8E93"
                value={query}
                onChangeText={setQuery}
                className="flex-1 text-espresso text-sm"
                style={{ fontFamily: "SpaceGrotesk_500Medium" }}
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery("")} hitSlop={8}>
                  <X size={16} color="#8E8E93" />
                </Pressable>
              )}
            </View>
          ) : (
            <Text
              className="text-espresso text-[22px] flex-1"
              style={{ fontFamily: "Peachi-Bold" }}
            >
              Pickup
            </Text>
          )}
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setSearchOpen((v) => !v);
              if (searchOpen) setQuery("");
            }}
            className="p-1 active:opacity-60"
            hitSlop={8}
          >
            {searchOpen ? (
              <Text className="text-primary text-sm font-medium">Cancel</Text>
            ) : (
              <Search size={20} color="#8E8E93" />
            )}
          </Pressable>
          <Pressable
            onPress={() => router.push("/cart")}
            className="p-1 relative active:opacity-60"
            hitSlop={8}
          >
            <ShoppingCart size={20} color="#160800" />
            {cartCount(cart) > 0 && (
              <View className="absolute -top-0.5 -right-0.5 bg-primary rounded-full w-4 h-4 items-center justify-center">
                <Text className="text-white text-[9px] font-bold">{cartCount(cart)}</Text>
              </View>
            )}
          </Pressable>
        </View>

        <Pressable
          onPress={() => {
            Haptics.selectionAsync();
            router.push("/store");
          }}
          className="flex-row items-center gap-2 px-4 pb-3 active:opacity-70"
        >
          <MapPin size={14} color="#C05040" />
          <Text className="text-espresso font-bold text-sm flex-1" numberOfLines={1}>
            {outletName ?? "Select outlet"}
          </Text>
          <ChevronDown size={14} color="#8E8E93" />
        </Pressable>
      </View>

      {/* Side category pills + product list */}
      <View className="flex-1 flex-row">
        {!query && (
          <View
            className="bg-surface border-r border-border"
            style={{ width: 80, flexShrink: 0 }}
          >
          <ScrollView
            style={{ flex: 1, width: 80 }}
            contentContainerStyle={{ width: 80, paddingHorizontal: 4, paddingTop: 8, paddingBottom: 180, gap: 6 }}
            showsVerticalScrollIndicator={false}
          >
            {/* "Usual" sits above Best Sellers because retention beats discovery
                — once a customer has a regular order, that's the fastest path
                back to the cart. Only renders for signed-in users with history. */}
            {hasUsual && (
              <SideCategoryPill
                active={active === USUAL_ID}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActive(USUAL_ID);
                }}
                icon={Heart}
                label="Usual"
                fill={active === USUAL_ID}
              />
            )}
            {hasBestSellers && (
              <SideCategoryPill
                active={active === BEST_SELLERS_ID}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActive(BEST_SELLERS_ID);
                }}
                icon={Star}
                label="Best Sellers"
                fill={active === BEST_SELLERS_ID}
              />
            )}
            {visibleCats.map((c) => {
              const Icon = CAT_ICON[c.id] ?? Coffee;
              return (
                <SideCategoryPill
                  key={c.id}
                  active={active === c.id}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setActive(c.id);
                  }}
                  icon={Icon}
                  label={c.name}
                />
              );
            })}
          </ScrollView>
          </View>
        )}

        <ScrollView
          className="flex-1"
          contentContainerClassName="pb-44"
          showsVerticalScrollIndicator={false}
        >
          {query && (
            <Text
              className="text-muted-fg text-xs px-4 pt-3 pb-1"
              style={{ fontFamily: "SpaceGrotesk_500Medium" }}
            >
              {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{query}"
            </Text>
          )}
          <View className="px-3 pt-3 gap-3">
            {filtered.length === 0 && (
              <View className="py-12 items-center">
                <Text
                  className="text-muted-fg text-sm"
                  style={{ fontFamily: "SpaceGrotesk_500Medium" }}
                >
                  {query ? "No matches" : "No products in this category"}
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
        </ScrollView>
      </View>

      {/* Cart pill — sits above bottom nav */}
      {cartCount(cart) > 0 && (
        <View
          className="absolute left-4 right-4"
          style={{ bottom: insets.bottom + 70 }}
        >
          <Pressable
            onPress={() => router.push("/cart")}
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
                <Text className="text-primary text-xs font-bold">{cartCount(cart)}</Text>
              </View>
              <Text className="text-white font-bold">View cart</Text>
            </View>
            <Text className="text-white font-bold">{formatPrice(cartTotal(cart))}</Text>
          </Pressable>
        </View>
      )}

      <BottomNav />
    </View>
  );
}

function SideCategoryPill({
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
      className={`rounded-2xl items-center justify-center gap-1 active:opacity-70 ${
        active ? "bg-espresso" : "bg-background"
      }`}
      style={{ width: 72, height: 64, paddingHorizontal: 4 }}
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
        style={{ fontFamily: "SpaceGrotesk_600SemiBold", width: 64 }}
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
      {product.image_url ? (
        <Image
          source={{ uri: product.image_url }}
          style={{ width: 88, height: 88, borderRadius: 24 }}
          resizeMode="cover"
        />
      ) : (
        <View style={{ width: 88, height: 88, borderRadius: 24, backgroundColor: "#F5F5F5" }} />
      )}
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
          <Text
            className="text-primary text-[13px]"
            style={{ fontFamily: "Peachi-Bold" }}
            numberOfLines={1}
          >
            {formatPrice(product.price)}
          </Text>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              if (hasModifiers) {
                router.push({ pathname: "/product/[id]", params: { id: product.id } });
              } else {
                onAdd();
              }
            }}
            hitSlop={8}
            className={`rounded-full items-center justify-center active:opacity-70 ${
              recentlyAdded ? "bg-green-600" : "bg-espresso"
            }`}
            style={{ width: 28, height: 28 }}
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
