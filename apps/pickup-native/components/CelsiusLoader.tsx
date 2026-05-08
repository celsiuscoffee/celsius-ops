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

// Rotating Celsius mark used in place of ActivityIndicator across the app.
// Continuous 1s linear rotation paired with a soft 1.4s breath (0.92↔1.0)
// so it reads as "alive" rather than mechanical. Animation is cancelled on
// unmount to keep the JS thread clean.
export function CelsiusLoader({ size = "md", style }: Props) {
  const { box, radius } = DIMENSIONS[size];
  const rotate = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    rotate.value = withRepeat(
      withTiming(360, { duration: 1000, easing: Easing.linear }),
      -1,
      false,
    );
    scale.value = withRepeat(
      withSequence(
        withTiming(0.92, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(rotate);
      cancelAnimation(scale);
    };
  }, [rotate, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotate.value}deg` }, { scale: scale.value }],
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
