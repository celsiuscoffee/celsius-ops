import { useEffect } from "react";
import { View, Text } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { ShoppingBag, Coffee, CheckCircle2, type LucideIcon } from "lucide-react-native";

// DoorDash-style top-anchored progress strip. Replaces the previous
// stepper-inside-a-card. Three signals:
//
//   1. A horizontal hairline rail with an animated terracotta fill
//      that grows as the order moves Received → Brewing → Ready.
//      Width animates on every status change for a visible "we just
//      progressed" beat.
//   2. Three step nodes pinned to the rail at 0% / 50% / 100%. The
//      current node pulses; past nodes go solid; future nodes stay
//      hollow.
//   3. A tiny text label under each node. Active label is full
//      espresso/terracotta; others muted.
//
// Designed to live directly under the header — full-bleed, no card
// chrome — so it reads like a live status indicator rather than just
// another card on the page.

const STEPS: Array<{ title: string; sub: string; Icon: LucideIcon }> = [
  { title: "Received",  sub: "Order placed",   Icon: ShoppingBag },
  { title: "Brewing",   sub: "Being prepared", Icon: Coffee },
  { title: "Ready",     sub: "Pick up now",    Icon: CheckCircle2 },
];

type Props = {
  /** -1 = not yet paid, 0 = received, 1 = brewing, 2 = ready/completed. */
  currentIndex: number;
  /** Accent tone — drives the rail fill + active node colour. Defaults
   *  to "warning" (in-flight). Pass "success" once the order reaches
   *  the final step (ready / completed) so the bar reads as a positive
   *  resolution rather than another in-progress state. */
  tone?: "warning" | "success" | "brand";
};

const TONE: Record<NonNullable<Props["tone"]>, string> = {
  warning: "#B45309",
  success: "#2E7D32",
  brand:   "#C05040",
};

export function OrderProgressStrip({ currentIndex, tone = "warning" }: Props) {
  const accent = TONE[tone];
  // Clamp into [0, 2] for the visible bar; -1 (pending payment) reads
  // as 0% with the Received node still hollow.
  const idx = Math.max(0, Math.min(2, currentIndex));
  const target = currentIndex < 0 ? 0 : idx / 2; // 0, 0.5, 1
  const fill = useSharedValue(target);

  useEffect(() => {
    fill.value = withTiming(target, {
      duration: 600,
      easing: Easing.out(Easing.cubic),
    });
  }, [target, fill]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fill.value * 100}%`,
  }));

  return (
    <View className="bg-background px-5 pt-3 pb-4 border-b border-border">
      {/* Rail */}
      <View className="relative" style={{ height: 4, marginTop: 22, marginBottom: 8 }}>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            height: 4,
            backgroundColor: "rgba(26,2,0,0.10)",
            borderRadius: 2,
          }}
        />
        <Animated.View
          style={[
            {
              position: "absolute",
              left: 0,
              top: 0,
              height: 4,
              backgroundColor: accent,
              borderRadius: 2,
            },
            fillStyle,
          ]}
        />
        {/* Nodes pinned at 0%, 50%, 100% */}
        {STEPS.map((step, i) => {
          const pct = (i / (STEPS.length - 1)) * 100;
          const state =
            currentIndex < 0
              ? "pending"
              : i < currentIndex
                ? "done"
                : i === currentIndex
                  ? "current"
                  : "pending";
          return (
            <Node
              key={step.title}
              Icon={step.Icon}
              state={state}
              leftPct={pct}
              accent={accent}
            />
          );
        })}
      </View>

      {/* Labels */}
      <View className="flex-row mt-3">
        {STEPS.map((step, i) => {
          const state =
            currentIndex < 0
              ? "pending"
              : i < currentIndex
                ? "done"
                : i === currentIndex
                  ? "current"
                  : "pending";
          const align =
            i === 0 ? "items-start" : i === STEPS.length - 1 ? "items-end" : "items-center";
          return (
            <View key={step.title} className={`flex-1 ${align}`}>
              <Text
                className="text-[10px] uppercase"
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  letterSpacing: 1.2,
                  color:
                    state === "current"
                      ? accent
                      : state === "done"
                        ? "#1A0200"
                        : "#8E8E93",
                }}
              >
                {step.title}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type NodeState = "pending" | "current" | "done";

function Node({
  Icon,
  state,
  leftPct,
  accent,
}: {
  Icon: LucideIcon;
  state: NodeState;
  leftPct: number;
  accent: string;
}) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (state !== "current") {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
      return;
    }
    scale.value = withRepeat(
      withSequence(
        withTiming(1.18, { duration: 700, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 700, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(scale);
  }, [state, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const SIZE = 28;
  const colors =
    state === "done"
      ? { bg: accent, icon: "#FFFFFF", border: "transparent" }
      : state === "current"
        ? { bg: accent, icon: "#FFFFFF", border: "transparent" }
        : { bg: "#FFFFFF", icon: "#8E8E93", border: "rgba(26,2,0,0.18)" };

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: `${leftPct}%`,
          top: -12, // center the 28px node on the 4px rail
          marginLeft: -SIZE / 2,
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: colors.bg,
          borderWidth: state === "pending" ? 1.5 : 0,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
          shadowColor: accent,
          shadowOpacity: state === "current" ? 0.18 : 0,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        },
        animStyle,
      ]}
    >
      <Icon size={14} color={colors.icon} strokeWidth={2.5} />
    </Animated.View>
  );
}
