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
  withTiming,
} from "react-native-reanimated";
import { Gift, Sparkles, ChevronRight, Check } from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
import { revealMysteryDrop, type MysteryDropRevealed } from "../lib/rewards-v2";
import { ShimmerSweep } from "./ShimmerSweep";

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

  // Card width captured via onLayout so the shared ShimmerSweep
  // overlay knows how far to translate the band. Initialised to 0 so
  // the band stays off-screen until layout reports a real width;
  // no first-paint flash.
  const [cardWidth, setCardWidth] = useState(0);

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
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w !== cardWidth) setCardWidth(w);
          }}
          className="rounded-2xl px-5 py-6 items-center overflow-hidden"
          style={[
            {
              // Saffron-yellow surface + espresso ink. Reads as a
              // "treasure / unwrap me" affordance and matches the
              // Mystery voucher tile in the wallet, so pre-reveal,
              // wallet, and reveal stay on the same visual lane.
              // Espresso shadow keeps the card lifted without
              // bleeding the brand-primary lane into Mystery.
              backgroundColor: "#FBBF24",
              shadowColor: "#1A0200",
              shadowOpacity: 0.28,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
              borderWidth: 1,
              borderColor: "rgba(26,2,0,0.25)", // espresso hairline on gold
            },
            cardScaleStyle,
          ]}
        >
          {/* White-tinted shimmer reads as light catching the gold
              surface — gives the card a "treasure" gleam without
              fighting the espresso ink. */}
          {!revealed && (
            <ShimmerSweep
              containerWidth={cardWidth}
              highlightColor="rgba(255,255,255,0.95)"
              maxOpacity={0.45}
              widthRatio={0.5}
              durationMs={2200}
            />
          )}

          <Gift size={44} color="#1A0200" strokeWidth={1.8} />

          <Text
            className="text-[10px] uppercase mt-3.5"
            style={{
              fontFamily: "SpaceGrotesk_700Bold",
              letterSpacing: 2,
              color: "rgba(26,2,0,0.7)",
            }}
          >
            Tap to Reveal
          </Text>
          <Text
            className="text-[26px] mt-1"
            style={{ fontFamily: "Peachi-Bold", letterSpacing: -0.3, color: "#1A0200" }}
          >
            Mystery Bean
          </Text>
          <Text
            className="text-[13px] mt-1.5 text-center"
            style={{ fontFamily: "SpaceGrotesk_500Medium", color: "rgba(26,2,0,0.72)" }}
          >
            You&apos;ve got something. One tap.
          </Text>

          <View
            className="rounded-full mt-4 px-5 py-2.5 flex-row items-center"
            style={{ gap: 6, backgroundColor: "#1A0200" /* espresso CTA */ }}
          >
            {loading ? (
              <>
                <ActivityIndicator size="small" color="#FBBF24" />
                <Text
                  className="text-[13px]"
                  style={{ fontFamily: "Peachi-Bold", color: "#FBBF24" }}
                >
                  Revealing…
                </Text>
              </>
            ) : (
              <>
                <Text
                  className="text-[13px]"
                  style={{ fontFamily: "Peachi-Bold", color: "#FBBF24" }}
                >
                  Reveal
                </Text>
                <ChevronRight size={14} color="#FBBF24" strokeWidth={2.4} />
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
  // Reveal entrance: scale-pop with a slight overshoot so the prize
  // feels like it "lands" on screen, paired with a success haptic so
  // the customer FEELS the win as much as they see it. Previous
  // fade+slide read as "another card loading" rather than "ta-da".
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.82);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 220 });
    scale.value = withSpring(1, { damping: 9, stiffness: 160, mass: 0.6 });
    // Haptic anchored to the reveal — the no-bonus path uses a Warning
    // pattern so the customer still feels something, but distinct.
    const pattern =
      drop.outcome_type === "no_bonus"
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success;
    Haptics.notificationAsync(pattern).catch(() => {});
  }, [opacity, scale, drop.outcome_type]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
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
            Added to your rewards
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
        label={isVoucher ? "View in rewards" : "Got it"}
        leadingIcon={isVoucher ? "gift" : "check"}
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
  leadingIcon?: "gift" | "check";
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
      {leadingIcon === "gift"  && <Gift  size={15} color={fg} strokeWidth={2.4} />}
      {leadingIcon === "check" && <Check size={15} color={fg} strokeWidth={2.6} />}
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}
