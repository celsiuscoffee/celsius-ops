import { useEffect, useRef } from "react";
import { Animated, View, type ViewStyle } from "react-native";

type Props = {
  /** Width — number (px) or string ("100%", "50%") */
  width?: number | string;
  /** Height in px */
  height?: number;
  /** Border radius in px. Default 8 */
  radius?: number;
  /** Tailwind className to override layout (e.g. "mt-2") */
  className?: string;
};

// Branded skeleton loader — soft pulsing terracotta-tinted block.
// Use in place of <ActivityIndicator /> on list-shaped screens; the
// shape-of-the-content telegraphs what's loading instead of a blank
// spinner.
export function Skeleton({
  width = "100%",
  height = 16,
  radius = 8,
  className = "",
}: Props) {
  const pulse = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.5,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const style: ViewStyle = {
    width: width as ViewStyle["width"],
    height,
    borderRadius: radius,
    backgroundColor: "#FBE9E4",
    opacity: pulse as unknown as number,
  };

  return (
    <Animated.View
      style={style}
      className={className}
    />
  );
}

// Standard row skeleton — mirrors the shape of a typical list card so
// the transition from loading → loaded feels seamless.
export function SkeletonRow() {
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3">
      <Skeleton width={40} height={40} radius={8} />
      <View className="flex-1 gap-2">
        <Skeleton width="60%" height={12} />
        <Skeleton width="40%" height={10} />
      </View>
      <Skeleton width={32} height={12} />
    </View>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View className="gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}
