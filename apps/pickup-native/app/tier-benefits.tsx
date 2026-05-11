import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Dimensions,
  Pressable,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import Svg, {
  Defs,
  LinearGradient as SvgLinearGradient,
  RadialGradient as SvgRadialGradient,
  Stop,
  Rect,
  Circle,
  Ellipse,
  Path,
  G,
  Pattern,
} from "react-native-svg";
import { Stack, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Star, Gift, Calendar, Sparkles, Lock, Coffee } from "lucide-react-native";
import { EspressoHeader } from "../components/EspressoHeader";
import { CelsiusLoader } from "../components/CelsiusLoader";
import { useApp } from "../lib/store";
import { fetchTier } from "../lib/rewards";
import { supabase } from "../lib/supabase";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 32;          // 16px gutter each side
const CARD_GAP = 12;
const SNAP = CARD_W + CARD_GAP;

type BenefitRule = {
  type: string;
  value?: number;
  label?: string;
  reward_id?: string;
};

type Tier = {
  id: string;
  slug: string;
  name: string;
  min_visits: number | null;
  min_spend: number | null;
  multiplier: number;
  color: string | null;
  icon: string | null;
  benefits: string[] | null;
  benefit_rules: BenefitRule[] | null;
  qualification_metric: string | null;
  sort_order: number | null;
};

async function fetchAllTiers(): Promise<Tier[]> {
  const { data, error } = await supabase
    .from("tiers")
    .select("id,slug,name,min_visits,min_spend,multiplier,color,icon,benefits,benefit_rules,qualification_metric,sort_order")
    .eq("brand_id", "brand-celsius")
    .eq("is_active", true)
    .order("sort_order", { ascending: true, nullsFirst: true })
    .order("min_visits", { ascending: true, nullsFirst: true });
  if (error) throw error;
  return (data ?? []) as Tier[];
}

export default function TierBenefits() {
  const loyaltyId = useApp((s) => s.loyaltyId);
  const tiersQ = useQuery({ queryKey: ["tiers"], queryFn: fetchAllTiers, staleTime: 5 * 60_000 });
  const memberTierQ = useQuery({
    queryKey: ["member-tier", loyaltyId],
    queryFn: () => (loyaltyId ? fetchTier(loyaltyId) : Promise.resolve(null)),
    enabled: !!loyaltyId,
    staleTime: 60_000,
  });

  const tiers = tiersQ.data ?? [];
  const currentSlug = memberTierQ.data?.tier_slug ?? null;
  const currentIdx = useMemo(
    () => Math.max(0, tiers.findIndex((t) => t.slug === currentSlug)),
    [tiers, currentSlug],
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Snap to the customer's current tier on first load.
  useEffect(() => {
    if (tiers.length === 0) return;
    setActiveIdx(currentIdx);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: currentIdx * SNAP, animated: false });
    });
  }, [tiers.length, currentIdx]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / SNAP);
    if (idx !== activeIdx && idx >= 0 && idx < tiers.length) setActiveIdx(idx);
  };

  if (tiersQ.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <EspressoHeader title="Membership" showBack showCart={false} />
        <View className="flex-1 items-center justify-center">
          <CelsiusLoader size="md" />
        </View>
      </View>
    );
  }

  const activeTier = tiers[activeIdx];

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Membership" showBack showCart={false} />

      <ScrollView contentContainerClassName="pb-24">
        {/* Tier pager — horizontal swipe between tier cards */}
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={SNAP}
          snapToAlignment="start"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}
          onMomentumScrollEnd={onScroll}
        >
          {tiers.map((t, idx) => (
            <View key={t.id} style={{ width: CARD_W, marginRight: idx < tiers.length - 1 ? CARD_GAP : 0 }}>
              <TierHeroCard
                tier={t}
                isCurrent={idx === currentIdx}
                isLocked={idx > currentIdx}
                isAchieved={idx < currentIdx}
                memberVisits={memberTierQ.data?.visits_this_period ?? 0}
                memberSpend={memberTierQ.data?.spend_this_period ?? 0}
              />
            </View>
          ))}
        </ScrollView>

        {/* Page indicator dots */}
        <View className="flex-row items-center justify-center mt-3" style={{ gap: 6 }}>
          {tiers.map((_, idx) => (
            <View
              key={idx}
              style={{
                width: idx === activeIdx ? 14 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: idx === activeIdx ? "#160800" : "rgba(26,2,0,0.18)",
              }}
            />
          ))}
        </View>

        {/* Benefits for the active tier */}
        {activeTier ? (
          <BenefitsSection tier={activeTier} isLocked={activeIdx > currentIdx} />
        ) : null}
      </ScrollView>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Per-tier themes — each tier gets a unique gradient, accent palette, and    */
/* SVG character. Colour theory mirrors the coffee identity: cream → silver  */
/* → gold → espresso-with-gold-accent. Matches the "card escalates with you" */
/* feel of CHAGEE's reference design.                                         */
/* ────────────────────────────────────────────────────────────────────────── */

type TierTheme = {
  gradTop:        string;
  gradBottom:     string;
  accent:         string; // primary text / progress bar
  accentDeep:     string; // darker variant for emphasis
  subtle:         string; // muted body text on the card
  cupCream:       string; // foam colour on the SVG illustration
  cupCoffee:      string; // espresso body
  cupGlass:       string; // outline / glass tone
  watermark:      string; // "CELSIUS" outline watermark on top
  pattern:        "beans" | "swirl" | "crema" | "stars";
  patternOpacity: number;
};

const TIER_THEMES: Record<string, TierTheme> = {
  bronze: {
    gradTop:        "#FFF6E2",
    gradBottom:     "#E4CFA5",
    accent:         "#7A4B16",
    accentDeep:     "#492A07",
    subtle:         "rgba(73,42,7,0.62)",
    cupCream:       "#FFE9B8",
    cupCoffee:      "#8C5A2C",
    cupGlass:       "#7A4B16",
    watermark:      "rgba(122,75,22,0.10)",
    pattern:        "beans",
    patternOpacity: 0.06,
  },
  silver: {
    gradTop:        "#F1F4F6",
    gradBottom:     "#B6C3CC",
    accent:         "#3F4A55",
    accentDeep:     "#1F262E",
    subtle:         "rgba(31,38,46,0.58)",
    cupCream:       "#FFFFFF",
    cupCoffee:      "#6F7A85",
    cupGlass:       "#3F4A55",
    watermark:      "rgba(63,74,85,0.10)",
    pattern:        "swirl",
    patternOpacity: 0.07,
  },
  gold: {
    gradTop:        "#FFF1C2",
    gradBottom:     "#D6A55A",
    accent:         "#6B4A0F",
    accentDeep:     "#3F2A04",
    subtle:         "rgba(63,42,4,0.62)",
    cupCream:       "#FFF1C2",
    cupCoffee:      "#A47836",
    cupGlass:       "#6B4A0F",
    watermark:      "rgba(107,74,15,0.10)",
    pattern:        "crema",
    patternOpacity: 0.08,
  },
  elite: {
    gradTop:        "#241408",
    gradBottom:     "#040201",
    accent:         "#E8C766",
    accentDeep:     "#FFE08C",
    subtle:         "rgba(232,199,102,0.72)",
    cupCream:       "#FFE5A1",
    cupCoffee:      "#5A3C0F",
    cupGlass:       "#E8C766",
    watermark:      "rgba(232,199,102,0.08)",
    pattern:        "stars",
    patternOpacity: 0.18,
  },
};

function themeFor(tier: Tier): TierTheme {
  return TIER_THEMES[tier.slug] ?? TIER_THEMES.bronze;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Background — SVG gradient + tier-specific pattern motif                    */
/* ────────────────────────────────────────────────────────────────────────── */

function CardBackground({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }} pointerEvents="none">
      <Defs>
        <SvgLinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={theme.gradTop} stopOpacity="1" />
          <Stop offset="1" stopColor={theme.gradBottom} stopOpacity="1" />
        </SvgLinearGradient>
        {/* Highlight overlay across the top-left to feel like a glossy card */}
        <SvgRadialGradient id="hl" cx="0.15" cy="0.0" rx="0.9" ry="0.7">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={theme.gradTop === "#241408" ? "0.10" : "0.55"} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>

      <Rect x="0" y="0" width={width} height={height} fill="url(#bg)" rx={18} ry={18} />
      <Rect x="0" y="0" width={width} height={height} fill="url(#hl)" rx={18} ry={18} />

      {/* Per-tier pattern overlay */}
      {theme.pattern === "beans" && <PatternBeans theme={theme} width={width} height={height} />}
      {theme.pattern === "swirl" && <PatternSwirl theme={theme} width={width} height={height} />}
      {theme.pattern === "crema" && <PatternCrema theme={theme} width={width} height={height} />}
      {theme.pattern === "stars" && <PatternStars theme={theme} width={width} height={height} />}
    </Svg>
  );
}

function PatternBeans({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
  // Subtle scattered coffee-bean glyphs.
  const beans: Array<{ cx: number; cy: number; r: number; rot: number }> = [
    { cx: width * 0.78, cy: height * 0.22, r: 7,  rot: 25  },
    { cx: width * 0.88, cy: height * 0.55, r: 5,  rot: -10 },
    { cx: width * 0.62, cy: height * 0.82, r: 6,  rot: 70  },
    { cx: width * 0.05, cy: height * 0.78, r: 4,  rot: 15  },
  ];
  return (
    <G opacity={theme.patternOpacity * 8}>
      {beans.map((b, i) => (
        <G key={i} transform={`rotate(${b.rot} ${b.cx} ${b.cy})`}>
          <Ellipse cx={b.cx} cy={b.cy} rx={b.r * 1.6} ry={b.r} fill={theme.accentDeep} />
          <Path
            d={`M ${b.cx - b.r * 1.2} ${b.cy} Q ${b.cx} ${b.cy - b.r * 0.4} ${b.cx + b.r * 1.2} ${b.cy}`}
            stroke={theme.gradTop}
            strokeWidth={1}
            fill="none"
          />
        </G>
      ))}
    </G>
  );
}

function PatternSwirl({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
  // Latte-art ripple lines — sweeping curves across the card.
  return (
    <G opacity={theme.patternOpacity * 6} stroke={theme.accent} strokeWidth={1.2} fill="none">
      <Path d={`M -10 ${height * 0.35} Q ${width * 0.5} ${height * 0.05} ${width + 10} ${height * 0.45}`} />
      <Path d={`M -10 ${height * 0.65} Q ${width * 0.5} ${height * 0.35} ${width + 10} ${height * 0.75}`} />
      <Path d={`M -10 ${height * 0.90} Q ${width * 0.5} ${height * 0.60} ${width + 10} ${height * 1.00}`} />
    </G>
  );
}

function PatternCrema({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
  // Concentric crema rings near the top-right.
  const cx = width * 0.82;
  const cy = height * 0.32;
  return (
    <G opacity={theme.patternOpacity * 8} stroke={theme.accentDeep} strokeWidth={1.2} fill="none">
      <Circle cx={cx} cy={cy} r={36} />
      <Circle cx={cx} cy={cy} r={48} />
      <Circle cx={cx} cy={cy} r={60} />
      <Circle cx={cx} cy={cy} r={72} />
    </G>
  );
}

function PatternStars({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
  // Tiny gold flecks for the Platinum tier.
  const stars: Array<{ cx: number; cy: number; r: number }> = [
    { cx: width * 0.20, cy: height * 0.20, r: 1.5 },
    { cx: width * 0.40, cy: height * 0.10, r: 1.0 },
    { cx: width * 0.55, cy: height * 0.32, r: 1.8 },
    { cx: width * 0.78, cy: height * 0.15, r: 1.2 },
    { cx: width * 0.92, cy: height * 0.40, r: 1.5 },
    { cx: width * 0.10, cy: height * 0.55, r: 1.0 },
    { cx: width * 0.25, cy: height * 0.85, r: 1.4 },
    { cx: width * 0.65, cy: height * 0.78, r: 1.0 },
    { cx: width * 0.86, cy: height * 0.92, r: 1.8 },
  ];
  return (
    <G opacity={theme.patternOpacity * 5}>
      {stars.map((s, i) => (
        <Circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill={theme.accent} />
      ))}
    </G>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Coffee-cup mascot — drawn in SVG, scaled and tinted per tier.              */
/* Slug 'elite' (Platinum) gets an extra gold rim + crown floret.             */
/* ────────────────────────────────────────────────────────────────────────── */

function TierMascot({ theme, slug, size = 100 }: { theme: TierTheme; slug: string; size?: number }) {
  const w = size, h = size;
  // Geometry tuned for a tumbler-style glass: 60% body, 30% foam, 10% rim
  return (
    <Svg width={w} height={h}>
      <Defs>
        <SvgLinearGradient id={`bodyGrad-${slug}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.cupCoffee} stopOpacity="1" />
          <Stop offset="1" stopColor={theme.accentDeep} stopOpacity="1" />
        </SvgLinearGradient>
        <SvgLinearGradient id={`creamGrad-${slug}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <Stop offset="1" stopColor={theme.cupCream} stopOpacity="1" />
        </SvgLinearGradient>
      </Defs>

      {/* Saucer */}
      <Ellipse cx={w / 2} cy={h * 0.93} rx={w * 0.40} ry={h * 0.045} fill={theme.accentDeep} opacity="0.25" />

      {/* Glass outline */}
      <Path
        d={`M ${w * 0.25} ${h * 0.25}
            L ${w * 0.18} ${h * 0.88}
            Q ${w * 0.18} ${h * 0.92}, ${w * 0.22} ${h * 0.92}
            L ${w * 0.78} ${h * 0.92}
            Q ${w * 0.82} ${h * 0.92}, ${w * 0.82} ${h * 0.88}
            L ${w * 0.75} ${h * 0.25} Z`}
        fill={`url(#bodyGrad-${slug})`}
        stroke={theme.cupGlass}
        strokeWidth={1.5}
      />

      {/* Foam / cream layer */}
      <Path
        d={`M ${w * 0.25} ${h * 0.25}
            Q ${w * 0.5} ${h * 0.16}, ${w * 0.75} ${h * 0.25}
            L ${w * 0.73} ${h * 0.42}
            Q ${w * 0.5} ${h * 0.36}, ${w * 0.27} ${h * 0.42} Z`}
        fill={`url(#creamGrad-${slug})`}
      />

      {/* Cream highlight */}
      <Path
        d={`M ${w * 0.30} ${h * 0.27} Q ${w * 0.5} ${h * 0.21}, ${w * 0.70} ${h * 0.27}`}
        stroke="#FFFFFF"
        strokeWidth={1.2}
        opacity="0.7"
        fill="none"
      />

      {/* Cup-rim straw */}
      <Path
        d={`M ${w * 0.55} ${h * 0.10} L ${w * 0.48} ${h * 0.40}`}
        stroke={theme.accentDeep}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <Path
        d={`M ${w * 0.55} ${h * 0.10} L ${w * 0.48} ${h * 0.40}`}
        stroke={theme.cupCream}
        strokeWidth={1}
        strokeLinecap="round"
      />

      {/* Platinum-only: gold filigree crown above the cup */}
      {slug === "elite" && (
        <G opacity={0.95}>
          <Path
            d={`M ${w * 0.30} ${h * 0.18}
                L ${w * 0.34} ${h * 0.10}
                L ${w * 0.40} ${h * 0.17}
                L ${w * 0.46} ${h * 0.07}
                L ${w * 0.52} ${h * 0.17}
                L ${w * 0.58} ${h * 0.07}
                L ${w * 0.64} ${h * 0.17}
                L ${w * 0.70} ${h * 0.10}
                L ${w * 0.74} ${h * 0.18}`}
            stroke={theme.accent}
            strokeWidth={1.6}
            fill="none"
          />
          <Circle cx={w * 0.50} cy={h * 0.06} r={2.5} fill={theme.accent} />
        </G>
      )}

      {/* Gold tier: warm rim glow */}
      {slug === "gold" && (
        <Path
          d={`M ${w * 0.25} ${h * 0.25} Q ${w * 0.5} ${h * 0.18}, ${w * 0.75} ${h * 0.25}`}
          stroke="#FFD56B"
          strokeWidth={2}
          opacity={0.85}
          fill="none"
        />
      )}

      {/* Silver tier: subtle steam */}
      {slug === "silver" && (
        <G opacity={0.45} stroke={theme.cupGlass} strokeWidth={1.2} fill="none">
          <Path d={`M ${w * 0.45} ${h * 0.20} Q ${w * 0.50} ${h * 0.15}, ${w * 0.42} ${h * 0.08}`} />
          <Path d={`M ${w * 0.55} ${h * 0.20} Q ${w * 0.60} ${h * 0.15}, ${w * 0.58} ${h * 0.05}`} />
        </G>
      )}

      {/* Bronze tier: simple steam */}
      {slug === "bronze" && (
        <G opacity={0.35} stroke={theme.accentDeep} strokeWidth={1} fill="none">
          <Path d={`M ${w * 0.45} ${h * 0.20} Q ${w * 0.52} ${h * 0.12}, ${w * 0.45} ${h * 0.05}`} />
        </G>
      )}
    </Svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Hero card                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

const CARD_H = 192;

function TierHeroCard({
  tier,
  isCurrent,
  isLocked,
  isAchieved,
  memberVisits,
  memberSpend,
}: {
  tier: Tier;
  isCurrent: boolean;
  isLocked: boolean;
  isAchieved: boolean;
  memberVisits: number;
  memberSpend: number;
}) {
  const theme = themeFor(tier);
  const isDark = tier.slug === "elite";

  // Visit-based progress for the next tier — falls back to spend if visits not set.
  const needVisits = tier.min_visits ?? 0;
  const needSpend  = Number(tier.min_spend ?? 0);
  const cupsAway = Math.max(0, needVisits - memberVisits);
  const ringgitAway = Math.max(0, needSpend - memberSpend);
  const useVisits = needVisits > 0;
  const progressPct = useVisits
    ? Math.min(1, memberVisits / Math.max(1, needVisits))
    : Math.min(1, memberSpend / Math.max(1, needSpend));

  return (
    <View
      style={{
        height: CARD_H,
        borderRadius: 18,
        overflow: "hidden",
        opacity: isLocked ? 0.92 : 1,
        // Soft drop-shadow for depth (iOS); Android falls back to elevation.
        shadowColor: "#000",
        shadowOpacity: 0.10,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <CardBackground theme={theme} width={CARD_W} height={CARD_H} />

      {/* Mascot sits on the right of the card */}
      <View style={{ position: "absolute", right: 12, bottom: 8 }}>
        <TierMascot theme={theme} slug={tier.slug} size={120} />
      </View>

      {/* Watermark "CELSIUS" sliding across the top behind the content */}
      <Text
        numberOfLines={1}
        style={{
          position: "absolute",
          top: 6,
          left: 12,
          right: 12,
          fontFamily: "Peachi-Bold",
          fontSize: 56,
          letterSpacing: 4,
          color: theme.watermark,
          lineHeight: 60,
        }}
      >
        CELSIUS
      </Text>

      {/* Foreground content */}
      <View style={{ padding: 18, height: "100%", justifyContent: "space-between" }}>
        {/* Top eyebrow row */}
        <View>
          <View className="flex-row items-center" style={{ gap: 6 }}>
            {isCurrent ? (
              <View
                style={{
                  backgroundColor: theme.accent,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                }}
              >
                <Text
                  style={{
                    color: isDark ? "#1A0A00" : "#FFFFFF",
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    letterSpacing: 1.5,
                  }}
                >
                  MY TIER
                </Text>
              </View>
            ) : isAchieved ? (
              <Text
                style={{
                  fontFamily: "SpaceGrotesk_700Bold",
                  fontSize: 10,
                  letterSpacing: 1.5,
                  color: theme.subtle,
                }}
              >
                UNLOCKED
              </Text>
            ) : (
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <Lock size={11} color={theme.subtle as string} />
                <Text
                  style={{
                    fontFamily: "SpaceGrotesk_700Bold",
                    fontSize: 10,
                    letterSpacing: 1.5,
                    color: theme.subtle,
                  }}
                >
                  LOCKED
                </Text>
              </View>
            )}
          </View>

          {/* Tier name */}
          <Text
            style={{
              marginTop: 8,
              fontFamily: "Peachi-Bold",
              fontSize: 26,
              color: theme.accent,
              lineHeight: 30,
            }}
            numberOfLines={1}
          >
            {tier.name}
          </Text>

          {/* Multiplier badge */}
          <View className="flex-row items-center" style={{ marginTop: 4, gap: 4 }}>
            <Coffee size={12} color={theme.accent} />
            <Text
              style={{
                fontFamily: "SpaceGrotesk_700Bold",
                fontSize: 12,
                color: theme.accent,
              }}
            >
              {formatMul(tier.multiplier)}× points
            </Text>
          </View>
        </View>

        {/* Bottom progress / requirement strip — sits within the left 65% so
            it doesn't run into the mascot. */}
        <View style={{ width: "62%" }}>
          {isCurrent ? (
            <>
              <View
                style={{
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: isDark ? "rgba(232,199,102,0.22)" : "rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.round(progressPct * 100)}%`,
                    backgroundColor: theme.accent,
                    borderRadius: 3,
                  }}
                />
              </View>
              <Text
                style={{
                  marginTop: 6,
                  fontFamily: "SpaceGrotesk_500Medium",
                  fontSize: 12,
                  color: theme.subtle,
                }}
                numberOfLines={1}
              >
                {cupsAway === 0 && ringgitAway === 0
                  ? "Top of this tier"
                  : useVisits
                    ? `${cupsAway} cup${cupsAway === 1 ? "" : "s"} this period`
                    : `RM${ringgitAway.toFixed(0)} more this period`}
              </Text>
            </>
          ) : isLocked ? (
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 12,
                color: theme.subtle,
                lineHeight: 16,
              }}
              numberOfLines={2}
            >
              Achieving {tier.name} requires{" "}
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", color: theme.accent }}>
                {useVisits ? `${needVisits} cups` : `RM${needSpend.toFixed(0)}`}
              </Text>
            </Text>
          ) : (
            <Text
              style={{
                fontFamily: "SpaceGrotesk_500Medium",
                fontSize: 12,
                color: theme.subtle,
              }}
            >
              Achieved · perks unlocked
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function formatMul(m: number | string | null | undefined): string {
  const n = Number(m ?? 1);
  // 1 → "1", 1.25 → "1.25", 1.5 → "1.5", 2 → "2"
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Benefits section                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function BenefitsSection({ tier, isLocked }: { tier: Tier; isLocked: boolean }) {
  const rules = tier.benefit_rules ?? [];

  // Group benefit_rules into customer-facing sections.
  const points    = rules.filter((r) => r.type === "points_multiplier");
  const birthday  = rules.filter((r) => r.type === "birthday_reward");
  const perks     = rules.filter((r) => r.type === "early_access" || r.type === "monthly_perk");
  const exclusive = rules.filter((r) => r.type === "exclusive_event");

  const fallbackBenefits = (tier.benefits ?? []).filter(
    (b) => !points.some((p) => b.includes(`${p.value}×`)) && !birthday.length || true, // always render below if rules empty
  );

  return (
    <View className="px-4" style={{ paddingTop: 16 }}>
      {points.length > 0 && (
        <Section title="Member Rewards" muted={isLocked}>
          <BenefitCard
            icon={<Star size={20} color="#C05040" />}
            label={`${Number(points[0].value).toString().replace(/\.0$/, "")}× points on every purchase`}
            muted={isLocked}
          />
        </Section>
      )}

      {birthday.length > 0 && (
        <Section title="Birthday Gifts" muted={isLocked}>
          <BenefitCard icon={<Gift size={20} color="#C05040" />} label="Free birthday drink" muted={isLocked} />
        </Section>
      )}

      {perks.length > 0 && (
        <Section title="Member Perks" muted={isLocked}>
          {perks.map((p, i) => (
            <BenefitCard
              key={i}
              icon={<Calendar size={20} color="#C05040" />}
              label={p.label ?? p.type.replace(/_/g, " ")}
              muted={isLocked}
            />
          ))}
        </Section>
      )}

      {exclusive.length > 0 && (
        <Section title="VIP Special" muted={isLocked}>
          {exclusive.map((p, i) => (
            <BenefitCard
              key={i}
              icon={<Sparkles size={20} color="#C05040" />}
              label={p.label ?? "Exclusive event invites"}
              muted={isLocked}
            />
          ))}
        </Section>
      )}

      {/* If the DB only has plain `benefits[]` strings (no benefit_rules),
          show them as a flat fallback list so nothing important is hidden. */}
      {rules.length === 0 && (tier.benefits?.length ?? 0) > 0 && (
        <Section title="What you get" muted={isLocked}>
          {tier.benefits!.map((b, i) => (
            <BenefitCard key={i} icon={<Star size={20} color="#C05040" />} label={b} muted={isLocked} />
          ))}
        </Section>
      )}

      {/* CTA to rewards screen for actual point-redemption catalogue */}
      <Pressable
        onPress={() => router.push("/rewards")}
        className="mt-4 rounded-xl border border-primary/40 bg-primary/5 p-4 active:opacity-70"
        accessibilityRole="button"
        accessibilityLabel="View rewards catalogue"
      >
        <Text style={{ color: "#C05040", fontFamily: "Peachi-Bold", fontSize: 15 }}>
          See rewards catalogue →
        </Text>
        <Text
          style={{
            color: "rgba(26,2,0,0.6)",
            fontFamily: "SpaceGrotesk_400Regular",
            fontSize: 12,
            marginTop: 4,
            lineHeight: 18,
          }}
        >
          Redeem points for free drinks, RM5 / RM10 vouchers, and birthday gifts
        </Text>
      </Pressable>
    </View>
  );
}

function Section({
  title,
  children,
  muted,
}: {
  title: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      <Text
        style={{
          fontFamily: "Peachi-Bold",
          fontSize: 16,
          color: muted ? "rgba(26,2,0,0.55)" : "#160800",
          marginBottom: 10,
        }}
      >
        {title}
      </Text>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function BenefitCard({
  icon,
  label,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  muted?: boolean;
}) {
  return (
    <View
      className="flex-row items-center rounded-xl border border-border bg-surface p-3"
      style={{ gap: 12, opacity: muted ? 0.55 : 1 }}
    >
      <View
        className="rounded-lg items-center justify-center"
        style={{ width: 40, height: 40, backgroundColor: "rgba(192,80,64,0.08)" }}
      >
        {icon}
      </View>
      <Text
        className="flex-1"
        style={{
          fontFamily: "SpaceGrotesk_500Medium",
          fontSize: 14,
          color: "#160800",
          lineHeight: 20,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim().replace(/^#/, ""));
  if (!m) return `rgba(146,64,14,${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}
