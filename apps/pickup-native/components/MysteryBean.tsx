/**
 * MysteryBean — tap-to-reveal scratch card displayed on order confirmation.
 *
 * UX notes (the v2 rewrite that fixed the "reveal disappears" bug):
 *  - The reveal outcome is held in local state. The parent decides when
 *    to unmount via `onDismiss`. Crucially we DON'T let the parent's
 *    React Query refetch (which returns `revealed:true` from the server
 *    a beat later) yank the reveal out from under the user — the parent
 *    now gates on a sticky local flag, not on the live query data.
 *  - The shimmer animation stops the moment we reveal. Infinite
 *    `withRepeat` was costing animation cost during/after reveal.
 *  - Every reveal state ends with an explicit CTA so the customer
 *    never sees a card with "now what?" ambiguity. Voucher wins go
 *    to the wallet, everything else dismisses cleanly.
 *
 * States:
 *  - Unrevealed: terracotta tile, shimmer + "Reveal" pill
 *  - Win (multiplier/flat/voucher/surprise): espresso surface, amber title
 *  - No-bonus: quiet white card with brand border — never feels punishing
 */

import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import Animated, {
  useSharedValue, useAnimatedStyle, withSequence, withSpring,
  withTiming, withRepeat, Easing, cancelAnimation,
} from "react-native-reanimated";
import { Gift, Sparkles, ChevronRight, Check, Wallet } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { revealMysteryDrop, type MysteryDropRevealed } from "../lib/rewards-v2";

type Props = {
  dropId: string;
  baseBeansEarned: number;
  /** When the parent has already received a reveal payload (because the
   *  child fired onRevealed earlier this session, or because the child
   *  was remounted and the parent still holds the reveal), pass it
   *  back in here. The component skips the tap-to-reveal state and
   *  renders MysteryReveal directly — this is the safety net that
   *  prevents an accidental child remount from erasing a customer's
   *  reward. */
  prerevealed?: MysteryDropRevealed | null;
  /** Called once with the reveal payload so the parent can refresh
   *  beans / vouchers — and persist the payload so prerevealed can
   *  be supplied on the next render. */
  onRevealed?: (drop: MysteryDropRevealed) => void;
  /** Called when the customer taps the dismiss / wallet CTA on the
   *  reveal card. Only after this should the parent take us off-screen. */
  onDismiss?: () => void;
};

export function MysteryBean({ dropId, baseBeansEarned, prerevealed, onRevealed, onDismiss }: Props) {
  // Initialise from prerevealed so a remount lands straight on the
  // reveal screen without a single frame of the "Tap to reveal" card.
  const [revealed, setRevealed] = useState<MysteryDropRevealed | null>(prerevealed ?? null);
  const [loading, setLoading] = useState(false);

  // If the parent updates prerevealed after mount (e.g. async hydration
  // of a cached reveal), sync it in. Only ever moves NULL → reveal —
  // we never clear a local reveal because the parent decided not to.
  useEffect(() => {
    if (prerevealed && !revealed) {
      setRevealed(prerevealed);
    }
  }, [prerevealed, revealed]);

  // Shimmer — only runs while we're in the unrevealed state. Once
  // revealed we cancel it; an infinite withRepeat on a hidden node
  // would otherwise keep ticking in the background.
  const shimmer = useSharedValue(-1);
  useEffect(() => {
    if (revealed) {
      cancelAnimation(shimmer);
      return;
    }
    shimmer.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.linear }),
      -1,
      false,
    );
    return () => { cancelAnimation(shimmer); };
  }, [revealed, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmer.value * 220 }],
  }));

  const scale = useSharedValue(1);
  const cardScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Guard against double-taps in the brief window between the tap and
  // setLoading(true) — onPress can fire twice on low-end Android.
  const firingRef = useRef(false);

  async function handleReveal() {
    if (loading || revealed || firingRef.current) return;
    firingRef.current = true;
    setLoading(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await revealMysteryDrop(dropId);
      if (result.outcome_type === "no_bonus") {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      scale.value = withSequence(
        withTiming(0.85, { duration: 120 }),
        withSpring(1.0, { damping: 8, stiffness: 140 }),
      );
      setRevealed(result);
      onRevealed?.(result);
    } catch (err) {
      console.warn("Mystery reveal failed", err);
      // Brief haptic so a network failure isn't silent.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      firingRef.current = false;
      setLoading(false);
    }
  }

  if (!revealed) {
    return (
      <Pressable onPress={handleReveal} disabled={loading} accessibilityRole="button">
        <Animated.View
          className="bg-primary rounded-2xl px-5 py-6 items-center overflow-hidden"
          style={[
            {
              shadowColor: "#160800",
              shadowOpacity: 0.18,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            },
            cardScaleStyle,
          ]}
        >
          <Animated.View
            style={[
              {
                position: "absolute",
                top: 0,
                left: -120,
                width: 100,
                height: "100%",
                backgroundColor: "rgba(255,255,255,0.18)",
              },
              shimmerStyle,
            ]}
          />

          <Gift size={44} color="#FFFFFF" strokeWidth={1.8} />

          <Text
            className="text-white/85 text-[10px] uppercase mt-3.5"
            style={{ fontFamily: "SpaceGrotesk_700Bold", letterSpacing: 2 }}
          >
            Tap to Reveal
          </Text>
          <Text
            className="text-white text-[26px] mt-1"
            style={{ fontFamily: "Peachi-Bold", letterSpacing: -0.3 }}
          >
            Mystery Bean
          </Text>
          <Text
            className="text-white/85 text-[13px] mt-1.5 text-center"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            You&apos;ve got something. One tap.
          </Text>

          <View
            className="bg-white rounded-full mt-4 px-5 py-2.5 flex-row items-center"
            style={{ gap: 6 }}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#1A0200" />
            ) : (
              <>
                <Text
                  className="text-espresso text-[13px]"
                  style={{ fontFamily: "Peachi-Bold" }}
                >
                  Reveal
                </Text>
                <ChevronRight size={14} color="#1A0200" strokeWidth={2.4} />
              </>
            )}
          </View>
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <MysteryReveal
      drop={revealed}
      baseBeansEarned={baseBeansEarned}
      onDismiss={onDismiss}
    />
  );
}

function MysteryReveal({
  drop,
  baseBeansEarned,
  onDismiss,
}: {
  drop: MysteryDropRevealed;
  baseBeansEarned: number;
  onDismiss?: () => void;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 320 });
    translateY.value = withSpring(0, { damping: 12, stiffness: 110 });
  }, [opacity, translateY]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const isMultiplier =
    drop.outcome_type === "beans_multiplier" && drop.multiplier_value && drop.multiplier_value > 1;
  const isVoucher = drop.outcome_type === "voucher";
  const isNoBonus = drop.outcome_type === "no_bonus";
  const isFlat    = drop.outcome_type === "flat_beans" && drop.flat_beans_value;
  const isSurprise = drop.outcome_type === "surprise_in_store";

  // Decide the right post-reveal action. Voucher → wallet (so the
  // customer can SEE the thing they just won), beans/no-bonus/surprise
  // → simple acknowledge. We never auto-dismiss; the customer always
  // taps to leave the reveal screen.
  function handlePrimary() {
    Haptics.selectionAsync();
    if (isVoucher) {
      onDismiss?.();
      router.push("/rewards?tab=rewards" as never);
    } else {
      onDismiss?.();
    }
  }

  // No-bonus: quiet white card. Same as Card primitive (rounded-2xl + border-border).
  if (isNoBonus) {
    return (
      <Animated.View
        className="bg-surface rounded-2xl border border-border p-5 items-center"
        style={containerStyle}
      >
        <Sparkles size={32} color="#6B6B6B" strokeWidth={1.6} />
        <Text
          className="text-espresso text-[18px] mt-2.5"
          style={{ fontFamily: "Peachi-Bold" }}
        >
          No bonus this time
        </Text>
        <Text
          className="text-muted-fg text-[13px] mt-1 text-center"
          style={{ fontFamily: "SpaceGrotesk_500Medium" }}
        >
          Better luck on your next order ☕
        </Text>
        <DismissPill onPress={handlePrimary} variant="quiet" label="Got it" />
      </Animated.View>
    );
  }

  // Win: espresso surface + amber text — matches RewardTicket gold tone for auto-issued
  return (
    <Animated.View
      className="bg-espresso rounded-2xl px-6 py-7 items-center"
      style={[
        {
          shadowColor: "#1A0200",
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.18,
          shadowRadius: 18,
          elevation: 6,
        },
        containerStyle,
      ]}
    >
      <Sparkles size={38} color="#FBBF24" strokeWidth={1.6} />

      {isMultiplier && (
        <>
          <Text
            className="text-amber-400 mt-2.5"
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 56,
              letterSpacing: -2,
              lineHeight: 56,
            }}
          >
            {drop.multiplier_value}×
          </Text>
          <Text
            className="text-[10px] uppercase mt-1.5"
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              letterSpacing: 2,
              color: "rgba(251,191,36,0.85)",
            }}
          >
            Bean Multiplier
          </Text>
          <View
            style={{
              height: 1,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignSelf: "stretch",
              marginVertical: 18,
              marginHorizontal: -24,
            }}
          />
          <Text
            className="text-white/70 text-[13px] text-center"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            Your {baseBeansEarned} Beans became
          </Text>
          <Text
            className="text-white text-[22px] mt-0.5"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            {drop.total_beans_awarded} Beans
          </Text>
        </>
      )}

      {isVoucher && (
        <>
          <Text
            className="text-amber-400 text-[22px] text-center mt-2.5"
            style={{ fontFamily: "Peachi-Bold", letterSpacing: -0.3 }}
          >
            {drop.label}
          </Text>
          <Text
            className="text-white/75 text-[13px] mt-1.5 text-center"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            Added to your voucher wallet
          </Text>
        </>
      )}

      {isFlat && (
        <>
          <Text
            className="text-amber-400 mt-2.5"
            style={{ fontFamily: "Peachi-Bold", fontSize: 48, letterSpacing: -2 }}
          >
            +{drop.flat_beans_value}
          </Text>
          <Text
            className="text-[10px] uppercase mt-1"
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              letterSpacing: 2,
              color: "rgba(251,191,36,0.85)",
            }}
          >
            Bonus Beans
          </Text>
        </>
      )}

      {isSurprise && (
        <>
          <Text
            className="text-amber-400 text-[20px] text-center mt-2.5"
            style={{ fontFamily: "Peachi-Bold" }}
          >
            Surprise at pickup
          </Text>
          <Text
            className="text-white/75 text-[13px] mt-1.5 text-center"
            style={{ fontFamily: "SpaceGrotesk_500Medium" }}
          >
            Show this to the barista when you collect your order
          </Text>
        </>
      )}

      <DismissPill
        onPress={handlePrimary}
        variant="amber"
        label={isVoucher ? "View in wallet" : "Got it"}
        leadingIcon={isVoucher ? "wallet" : "check"}
      />
    </Animated.View>
  );
}

/** Bottom action pill — kept consistent across every reveal variant so
 *  the customer always knows where the "out" of the reveal is. The amber
 *  variant pops against the espresso card; the quiet variant is for the
 *  no-bonus white card. */
function DismissPill({
  onPress, label, variant, leadingIcon,
}: {
  onPress: () => void;
  label: string;
  variant: "amber" | "quiet";
  leadingIcon?: "wallet" | "check";
}) {
  const amberBg   = "#FBBF24";
  const amberFg   = "#1A0200";
  const quietBg   = "#1A0200";
  const quietFg   = "#FFFFFF";
  const bg = variant === "amber" ? amberBg : quietBg;
  const fg = variant === "amber" ? amberFg : quietFg;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        marginTop: 20,
        backgroundColor: bg,
        borderRadius: 100,
        paddingHorizontal: 20,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "stretch",
        justifyContent: "center",
      }}
      className="active:opacity-85"
    >
      {leadingIcon === "wallet" && <Wallet size={15} color={fg} strokeWidth={2.4} />}
      {leadingIcon === "check"  && <Check  size={15} color={fg} strokeWidth={2.6} />}
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}
