import { useEffect } from "react";
import { View, Image, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";

type Size = "sm" | "md" | "lg";

const DIMENSIONS: Record<Size, { box: number; radius: number }> = {
  sm: { box: 28, radius: 6 },
  md: { box: 48, radius: 10 },
  lg: { box: 80, radius: 16 },
};

type Props = {
  size?: Size;
  /** Optional wrapper style — for centering inside a parent. */
  style?: ViewStyle;
};

// Heartbeat-style Celsius mark — replaces the previous spinning
// loader. The continuous 1s linear rotation read as mechanical
// (laptop fan, app crashed) for a coffee brand. The mark now stays
// upright (logo always readable) and pulses scale + opacity together
// on a 1.2s heartbeat cadence — quick squeeze (200ms), slow breath
// out (1s). Reads as "alive / thinking" without the spinner trope.
export function CelsiusLoader({ size = "md", style }: Props) {
  const { box, radius } = DIMENSIONS[size];
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 200, easing: Easing.out(Easing.quad) }),
        withTiming(0.92, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1.0, { duration: 200, easing: Easing.out(Easing.quad) }),
        withTiming(0.55, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [scale, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={[{ alignItems: "center", justifyContent: "center" }, style]}>
      <Animated.View style={animStyle}>
        <Image
          source={require("../assets/icon.png")}
          style={{ width: box, height: box, borderRadius: radius }}
          resizeMode="cover"
        />
      </Animated.View>
    </View>
  );
}
