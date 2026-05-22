import { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { ShoppingBag, Coffee, CheckCircle2, type LucideIcon } from "lucide-react-native";

const STEPS: Array<{ title: string; sub: string; Icon: LucideIcon }> = [
  { title: "Received",  sub: "Order placed",   Icon: ShoppingBag },
  { title: "Brewing",   sub: "Being prepared", Icon: Coffee },
  { title: "Ready",     sub: "Pick up now",    Icon: CheckCircle2 },
];

type Props = {
  /** 0 = received, 1 = brewing, 2 = ready. */
  currentIndex: number;
};

/**
 * Horizontal 3-step pipeline shown on the order detail screen.
 *
 * Replaces the prior vertical timeline. Each step is a circular node
 * connected by a hairline rail. Done steps fill terracotta; the
 * current step pulses (subtle scale 1 → 1.12 → 1, repeating) to give
 * the customer an "alive" signal that we're working on their order
 * instead of refreshing the screen every few seconds.
 *
 * Layout & spacing tuned for a 343-wide content area (default home
 * scrollview width on a 393 screen with px-4). Card chrome lives on
 * the parent — this component is just the stepper itself plus its
 * own padding.
 */
export function OrderStepper({ currentIndex }: Props) {
  return (
    <View className="py-2">
      <View className="flex-row items-start">
        {STEPS.map((step, i) => {
          const isLast = i === STEPS.length - 1;
          return (
            <View key={step.title} className="flex-1">
              <View className="flex-row items-center">
                <Node
                  step={step}
                  state={i < currentIndex ? "done" : i === currentIndex ? "current" : "pending"}
                />
                {!isLast && <Rail filled={i < currentIndex} />}
              </View>
              <View className="mt-2.5" style={{ paddingRight: isLast ? 0 : 12 }}>
                <Text
                  className="text-[11px] uppercase"
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    letterSpacing: 1.5,
                    color:
                      i === currentIndex
                        ? "#A2492C"
                        : i < currentIndex
                        ? "#1A0200"
                        : "#8E8E93",
                  }}
                  numberOfLines={1}
                >
                  {step.title}
                </Text>
                <Text
                  className="text-[11px] mt-0.5"
                  style={{
                    fontFamily: "SpaceGrotesk_500Medium",
                    color: i === currentIndex ? "#A2492C" : "#8E8E93",
                  }}
                  numberOfLines={1}
                >
                  {step.sub}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type NodeState = "pending" | "current" | "done";

function Node({
  step,
  state,
}: {
  step: { Icon: LucideIcon };
  state: NodeState;
}) {
  // Pulse only on the current node — done/pending stay static so the
  // active step is visually unmistakable. cancel + reset on state
  // change so the animation doesn't leak across re-renders.
  const scale = useSharedValue(1);
  useEffect(() => {
    if (state !== "current") {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
      return;
    }
    scale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 700, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(scale);
  }, [state, scale]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const Icon = step.Icon;
  const SIZE = 36;

  // bg + icon color encode the state. Pending is hollow + muted, done
  // is filled terracotta-tint + terracotta icon, current is solid
  // terracotta + white icon.
  const styles = (() => {
    switch (state) {
      case "done":
        return { bg: "#FBEBE8", iconColor: "#A2492C", border: "transparent" };
      case "current":
        return { bg: "#A2492C", iconColor: "#FFFFFF", border: "transparent" };
      case "pending":
      default:
        return { bg: "#FFFFFF", iconColor: "#8E8E93", border: "rgba(26,2,0,0.12)" };
    }
  })();

  return (
    <Animated.View
      style={[
        {
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: styles.bg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: state === "pending" ? 1 : 0,
          borderColor: styles.border,
        },
        animStyle,
      ]}
    >
      <Icon size={18} color={styles.iconColor} strokeWidth={2} />
    </Animated.View>
  );
}

function Rail({ filled }: { filled: boolean }) {
  return (
    <View
      className="flex-1"
      style={{
        height: 2,
        marginHorizontal: 6,
        backgroundColor: filled ? "#A2492C" : "rgba(26,2,0,0.08)",
        borderRadius: 1,
      }}
    />
  );
}
