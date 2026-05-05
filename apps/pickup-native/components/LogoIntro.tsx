import { useEffect } from "react";
import { View, Image, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
  runOnJS,
} from "react-native-reanimated";

type Props = { onDone: () => void };

// Cold-launch brand intro that runs ahead of the backoffice splash poster.
// Total ~1.7s: 220ms fade-in + scale, 800ms hold, 600ms fade-out + slight
// scale-up. Tuned to feel premium without slowing the first launch
// noticeably — the JS bundle is finishing while this plays.
export function LogoIntro({ onDone }: Props) {
  const { width, height } = useWindowDimensions();
  const opacity = useSharedValue(0);
  const scale   = useSharedValue(0.85);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
      withDelay(800, withTiming(0, { duration: 600, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onDone)();
      })),
    );
    scale.value = withSequence(
      withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withDelay(800, withTiming(1.05, { duration: 600, easing: Easing.in(Easing.quad) })),
    );
  }, [opacity, scale, onDone]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        backgroundColor: "#160800",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <Animated.View style={logoStyle}>
        <Image
          source={require("../assets/icon.png")}
          style={{ width: 120, height: 120, borderRadius: 24 }}
          resizeMode="cover"
        />
      </Animated.View>
    </View>
  );
}
