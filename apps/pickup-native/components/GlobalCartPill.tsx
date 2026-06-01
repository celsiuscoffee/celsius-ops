import { Platform, View, Text, Pressable } from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp, cartCount, cartTotal } from "../lib/store";
import { formatPrice } from "../lib/api";
import * as Haptics from "@/lib/haptics";

/**
 * Global "View cart" pill. Mounted once at the root layout so it
 * lives outside the Stack — that's the only place where usePathname()
 * reliably re-renders on every navigation. (Previous attempts to gate
 * the pill inside the Home / Menu screen components didn't work
 * because expo-router on web keeps prior screens mounted, and the
 * background screens' hook subscriptions don't refresh when the route
 * changes — so the pill stayed visible on /cart even when the parent
 * screen was no longer "current".)
 *
 * Renders the pill only on browse routes where it adds value (home +
 * menu) AND only when the cart has items.
 *
 * NOT on /product: the product detail screen is a focused single-item
 * configurator that already owns the bottom CTA ("Add to cart" /
 * "Update cart"). A second floating "View cart" bar stacked above that
 * button is redundant — and in edit mode both bars showed the same
 * total. (#161 originally included /product here; that's the regression.)
 *
 * On web the pill portals to <body> via createPortal so it pins to
 * the visual viewport regardless of the surrounding flex layout.
 * Native uses absolute positioning inside the root view.
 */
const PILL_ROUTES = (pathname: string) =>
  pathname === "/" ||
  pathname.startsWith("/menu");

export function GlobalCartPill() {
  const pathname = usePathname();
  const cart = useApp((s) => s.cart);
  const insets = useSafeAreaInsets();

  if (!PILL_ROUTES(pathname)) return null;
  if (cartCount(cart) <= 0) return null;

  const count = cartCount(cart);
  const total = cartTotal(cart);
  const isWeb = Platform.OS === "web";

  const onPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push("/cart");
  };

  const webOverrides = isWeb
    ? ({
        position: "fixed" as unknown as "absolute",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" as unknown as number,
        left: 16,
        right: 16,
        zIndex: 99,
      } as const)
    : null;

  const bar = (
    <View
      className="absolute left-4 right-4"
      style={{
        bottom: insets.bottom + 70,
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
        accessibilityRole="button"
        accessibilityLabel={`View cart, ${count} ${count === 1 ? "item" : "items"}, ${formatPrice(total)}`}
      >
        <View className="flex-row items-center gap-2">
          <View className="bg-white rounded-full w-6 h-6 items-center justify-center">
            <Text className="text-primary text-xs font-bold">{count}</Text>
          </View>
          <Text className="text-white font-bold">View cart</Text>
        </View>
        <Text className="text-white font-bold">{formatPrice(total)}</Text>
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
