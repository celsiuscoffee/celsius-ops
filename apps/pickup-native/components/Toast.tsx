import { useEffect } from "react";
import { View, Text, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { useToast } from "../lib/toast";

/**
 * Global toast renderer. Mount once in app/_layout.tsx; subscribers fire
 * via showToast(...) from anywhere. Slide-in from top, auto-dismiss.
 *
 * Sits at the top instead of the bottom because the bottom is busy
 * with the cart pill + bottom nav on every screen — dropping a toast
 * there guarantees it covers either an action or navigation.
 */
export function Toast() {
  const insets = useSafeAreaInsets();
  const current = useToast((s) => s.current);
  const dismiss = useToast((s) => s.dismiss);
  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  // Drive the slide-in / hold / slide-out animation off the toast id —
  // a fresh show() with a new id resets everything cleanly even if the
  // previous toast hadn't dismissed yet.
  useEffect(() => {
    if (!current) {
      translateY.value = withTiming(-120, { duration: 200, easing: Easing.in(Easing.cubic) });
      opacity.value = withTiming(0, { duration: 150 });
      return;
    }
    translateY.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
    opacity.value = withTiming(1, { duration: 200 });
    const id = setTimeout(() => {
      runOnJS(dismiss)();
    }, current.durationMs ?? 2500);
    return () => clearTimeout(id);
  }, [current, translateY, opacity, dismiss]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!current) return null;

  const isSuccess = current.variant === "success";

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        {
          position: "absolute",
          top: insets.top + 8,
          left: 16,
          right: 16,
          zIndex: 9999,
        },
        style,
      ]}
    >
      <View
        style={{
          backgroundColor: "#1A0200",
          borderRadius: 16,
          paddingVertical: 12,
          paddingHorizontal: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          shadowColor: "#000",
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: isSuccess ? "#C05040" : "rgba(255,255,255,0.10)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Check size={14} color="#FFFFFF" strokeWidth={3} />
        </View>
        <Text
          style={{
            color: "#FFFFFF",
            fontFamily: "SpaceGrotesk_600SemiBold",
            fontSize: 13,
            flex: 1,
          }}
          numberOfLines={2}
        >
          {current.message}
        </Text>
        {current.action && (
          <Pressable
            onPress={() => {
              current.action?.onPress();
              dismiss();
            }}
            hitSlop={8}
            accessibilityLabel={current.action.label}
          >
            <Text
              style={{
                color: "#FBBF24",
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: 0.8,
              }}
            >
              {current.action.label}
            </Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
