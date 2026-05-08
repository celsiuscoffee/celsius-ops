import { View, Text, Pressable } from "react-native";
import { ArrowLeft, ShoppingCart } from "lucide-react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp, cartCount } from "../lib/store";

type Props = {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  showCart?: boolean;
  rightSlot?: React.ReactNode;
};

export function EspressoHeader({
  title,
  subtitle,
  showBack = false,
  showCart = true,
  rightSlot,
}: Props) {
  const insets = useSafeAreaInsets();
  const cart = useApp((s) => s.cart);
  const count = cartCount(cart);

  return (
    <View
      className="bg-espresso px-4 pb-5"
      style={{ paddingTop: insets.top + 12 }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          {showBack && (
            <Pressable
              onPress={() => router.back()}
              className="mr-3 -ml-1 p-1 active:opacity-60"
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ArrowLeft size={22} color="#FFFFFF" />
            </Pressable>
          )}
          <View className="flex-1">
            {subtitle && (
              <Text className="text-white/50 text-[10px] tracking-widest uppercase">
                {subtitle}
              </Text>
            )}
            {title && (
              <Text
                className="text-white text-[22px]"
                numberOfLines={1}
                style={{ fontFamily: "Peachi-Bold" }}
              >
                {title}
              </Text>
            )}
          </View>
        </View>
        {rightSlot ??
          (showCart && (
            <Pressable
              onPress={() => router.push("/cart")}
              className="relative p-1 active:opacity-60"
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={count > 0 ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}
            >
              <ShoppingCart size={22} color="rgba(255,255,255,0.8)" />
              {count > 0 && (
                <View className="absolute -top-0.5 -right-0.5 bg-white rounded-full w-4 h-4 items-center justify-center">
                  <Text className="text-primary text-[9px] font-bold">{count}</Text>
                </View>
              )}
            </Pressable>
          ))}
      </View>
    </View>
  );
}
