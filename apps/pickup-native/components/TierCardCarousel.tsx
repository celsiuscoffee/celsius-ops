import { useEffect, useRef, useState, useMemo } from "react";
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
} from "react-native-svg";
import { Lock, Coffee } from "lucide-react-native";

/* ────────────────────────────────────────────────────────────────────────── */
/* Public types                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export type TierLite = {
  id: string;
  slug: string;
  name: string;
  min_visits: number | null;
  min_spend: number | null;
  multiplier: number;
  color: string | null;
  icon: string | null;
  benefits: string[] | null;
  benefit_rules: unknown;
  qualification_metric: string | null;
  sort_order: number | null;
};

export type MemberStats = {
  points:   number;
  visits:   number;
  earned:   number;
};

export type CarouselProps = {
  tiers:        TierLite[];
  currentSlug:  string | null;
  memberVisits: number;
  memberSpend:  number;
  /** When set, the customer's CURRENT tier card folds in a
   *  Points / Visits / Earned row at the bottom — so the
   *  surrounding screen doesn't need a separate stats card. */
  stats?:       MemberStats;
  /** Card visual height in pixels. Defaults to 192 (matches Membership screen).
   *  When `stats` is provided, the current card auto-grows to fit the row. */
  cardHeight?: number;
  /** Tap handler — called with the tier the customer tapped on. */
  onCardPress?: (tier: TierLite) => void;
  /** Optional title shown above the carousel. */
  title?: string;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* Themes                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

type TierTheme = {
  gradTop:        string;
  gradBottom:     string;
  accent:         string;
  accentDeep:     string;
  subtle:         string;
  cupCream:       string;
  cupCoffee:      string;
  cupGlass:       string;
  watermark:      string;
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

export function themeForTier(tier: TierLite): TierTheme {
  return TIER_THEMES[tier.slug] ?? TIER_THEMES.bronze;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Public component — horizontal swipeable tier pager                         */
/* ────────────────────────────────────────────────────────────────────────── */

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W   = SCREEN_W - 32;
const CARD_GAP = 12;
const SNAP     = CARD_W + CARD_GAP;

export function TierCardCarousel({
  tiers,
  currentSlug,
  memberVisits,
  memberSpend,
  stats,
  cardHeight = 192,
  onCardPress,
  title,
}: CarouselProps) {
  // When stats are embedded, the current card needs more vertical room
  // for the bottom row + divider. Other cards keep the base height so
  // the pager swipe still snaps cleanly card-to-card.
  const effectiveHeight = stats ? Math.max(cardHeight, 232) : cardHeight;
  const currentIdx = useMemo(
    () => Math.max(0, tiers.findIndex((t) => t.slug === currentSlug)),
    [tiers, currentSlug],
  );

  const [activeIdx, setActiveIdx] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // Snap to the customer's current tier the first time the data shows up.
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

  if (tiers.length === 0) return null;

  return (
    <View>
      {title ? (
        <Text
          className="px-4"
          style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 11,
            letterSpacing: 2,
            color: "rgba(26,2,0,0.55)",
            marginTop: 12,
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          {title}
        </Text>
      ) : null}

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={SNAP}
        snapToAlignment="start"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 4 }}
        onMomentumScrollEnd={onScroll}
      >
        {tiers.map((t, idx) => (
          <View key={t.id} style={{ width: CARD_W, marginRight: idx < tiers.length - 1 ? CARD_GAP : 0 }}>
            <Pressable
              onPress={onCardPress ? () => onCardPress(t) : undefined}
              accessibilityRole={onCardPress ? "button" : undefined}
              accessibilityLabel={`${t.name} tier`}
              className={onCardPress ? "active:opacity-90" : ""}
            >
              <TierHeroCard
                tier={t}
                isCurrent={idx === currentIdx}
                isLocked={idx > currentIdx}
                isAchieved={idx < currentIdx}
                memberVisits={memberVisits}
                memberSpend={memberSpend}
                height={effectiveHeight}
                stats={idx === currentIdx ? stats : undefined}
              />
            </Pressable>
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
    </View>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Single hero card (exported for screens that want one without the pager)    */
/* ────────────────────────────────────────────────────────────────────────── */

export function TierHeroCard({
  tier,
  isCurrent,
  isLocked,
  isAchieved,
  memberVisits,
  memberSpend,
  height = 192,
  stats,
}: {
  tier:         TierLite;
  isCurrent:    boolean;
  isLocked:     boolean;
  isAchieved:   boolean;
  memberVisits: number;
  memberSpend:  number;
  height?:      number;
  /** When set on the current tier card, renders a Points / Visits /
   *  Earned row below the progress strip. Hidden on locked/achieved
   *  cards since those numbers are member-specific. */
  stats?:       MemberStats;
}) {
  const theme = themeForTier(tier);
  const isDark = tier.slug === "elite";

  const needVisits  = tier.min_visits ?? 0;
  const needSpend   = Number(tier.min_spend ?? 0);
  const cupsAway    = Math.max(0, needVisits - memberVisits);
  const ringgitAway = Math.max(0, needSpend - memberSpend);
  const useVisits   = needVisits > 0;
  const progressPct = useVisits
    ? Math.min(1, memberVisits / Math.max(1, needVisits))
    : Math.min(1, memberSpend / Math.max(1, needSpend));

  return (
    <View
      style={{
        height,
        borderRadius: 18,
        overflow: "hidden",
        opacity: isLocked ? 0.92 : 1,
        shadowColor: "#000",
        shadowOpacity: 0.10,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <CardBackground theme={theme} width={CARD_W} height={height} />

      {/* Brand wordmark watermark — giant outlined "C" sitting behind the
          content. Matches the Celsius brand-block identity (the same "C"
          that's on the takeaway cup) and gives every tier card the same
          recognisable backdrop without competing with the mascot. */}
      <CelsiusWordmark theme={theme} cardHeight={height} />

      <View style={{ position: "absolute", right: 12, bottom: 8 }}>
        <TierMascot theme={theme} slug={tier.slug} size={Math.min(height * 0.65, 130)} />
      </View>

      <View style={{ padding: 18, height: "100%", justifyContent: "space-between" }}>
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

          <View className="flex-row items-center" style={{ marginTop: 4, gap: 4 }}>
            <Coffee size={12} color={theme.accent} />
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, color: theme.accent }}>
              {formatMul(tier.multiplier)}× points
            </Text>
          </View>
        </View>

        {/* Progress / requirement strip — kept inside left 62% so the
            mascot has room. Stats row (when present) sits BELOW this
            block and spans the full width. */}
        <View>
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
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: theme.subtle }}>
                Achieved · perks unlocked
              </Text>
            )}
          </View>

          {/* Embedded stats row — only on the customer's current card. */}
          {isCurrent && stats ? (
            <View
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: isDark
                  ? "rgba(232,199,102,0.22)"
                  : "rgba(0,0,0,0.08)",
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <StatCell label="Points"  value={stats.points.toLocaleString()}  accent={theme.accent} subtle={theme.subtle} />
              <StatDivider isDark={isDark} />
              <StatCell label="Visits"  value={String(stats.visits)}            accent={theme.accent} subtle={theme.subtle} />
              <StatDivider isDark={isDark} />
              <StatCell label="Earned"  value={stats.earned.toLocaleString()}  accent={theme.accent} subtle={theme.subtle} />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function StatCell({
  label,
  value,
  accent,
  subtle,
}: {
  label:  string;
  value:  string;
  accent: string;
  subtle: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text
        style={{
          fontFamily: "Peachi-Bold",
          fontSize: 18,
          color: accent,
          lineHeight: 20,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        style={{
          fontFamily: "SpaceGrotesk_700Bold",
          fontSize: 9,
          letterSpacing: 1.2,
          color: subtle,
          marginTop: 2,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function StatDivider({ isDark }: { isDark: boolean }) {
  return (
    <View
      style={{
        width: 1,
        height: 28,
        backgroundColor: isDark ? "rgba(232,199,102,0.18)" : "rgba(0,0,0,0.10)",
      }}
    />
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Background + pattern + mascot (all SVG)                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/* Brand wordmark — the actual "°c" glyph from the Celsius app icon,
   set in Peachi-Bold (the app's brand serif). The "°" floats to the
   upper-left of the "c" exactly like the icon. Rendered as flat
   React Native Text (not SVG) so the typeface matches the rest of
   the brand surfaces 1:1 — same "c" the customer sees on the
   takeaway cup sleeve and the app icon. */
function CelsiusWordmark({ theme, cardHeight }: { theme: TierTheme; cardHeight: number }) {
  const size = cardHeight * 1.15;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: -size * 0.04,
        top: -size * 0.04,
        width: size,
        height: size,
      }}
    >
      {/* Degree mark — sits to the upper-left of the "c" cap height.
          Sized ~14% of the c glyph, exactly as in the icon.png. */}
      <View
        style={{
          position: "absolute",
          left: size * 0.18,
          top: size * 0.18,
          width: size * 0.10,
          height: size * 0.10,
          borderRadius: size * 0.05,
          borderWidth: Math.max(2, size * 0.015),
          borderColor: theme.watermark,
        }}
      />
      {/* The "c" — lowercase, Peachi-Bold, theme-tinted at low opacity. */}
      <Text
        style={{
          position: "absolute",
          left: size * 0.20,
          top: size * 0.05,
          fontFamily: "Peachi-Bold",
          fontSize: size * 0.95,
          lineHeight: size * 0.95,
          color: theme.watermark,
        }}
      >
        c
      </Text>
    </View>
  );
}

function CardBackground({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
  return (
    <Svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }} pointerEvents="none">
      <Defs>
        <SvgLinearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={theme.gradTop} stopOpacity="1" />
          <Stop offset="1" stopColor={theme.gradBottom} stopOpacity="1" />
        </SvgLinearGradient>
        <SvgRadialGradient id="hl" cx="0.15" cy="0.0" rx="0.9" ry="0.7">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={theme.gradTop === "#241408" ? "0.10" : "0.55"} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </SvgRadialGradient>
      </Defs>

      <Rect x="0" y="0" width={width} height={height} fill="url(#bg)" rx={18} ry={18} />
      <Rect x="0" y="0" width={width} height={height} fill="url(#hl)" rx={18} ry={18} />

      {theme.pattern === "beans" && <PatternBeans theme={theme} width={width} height={height} />}
      {theme.pattern === "swirl" && <PatternSwirl theme={theme} width={width} height={height} />}
      {theme.pattern === "crema" && <PatternCrema theme={theme} width={width} height={height} />}
      {theme.pattern === "stars" && <PatternStars theme={theme} width={width} height={height} />}
    </Svg>
  );
}

function PatternBeans({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
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
  return (
    <G opacity={theme.patternOpacity * 6} stroke={theme.accent} strokeWidth={1.2} fill="none">
      <Path d={`M -10 ${height * 0.35} Q ${width * 0.5} ${height * 0.05} ${width + 10} ${height * 0.45}`} />
      <Path d={`M -10 ${height * 0.65} Q ${width * 0.5} ${height * 0.35} ${width + 10} ${height * 0.75}`} />
      <Path d={`M -10 ${height * 0.90} Q ${width * 0.5} ${height * 0.60} ${width + 10} ${height * 1.00}`} />
    </G>
  );
}

function PatternCrema({ theme, width, height }: { theme: TierTheme; width: number; height: number }) {
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

function TierMascot({ theme, slug, size = 100 }: { theme: TierTheme; slug: string; size?: number }) {
  const w = size, h = size;
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

      <Ellipse cx={w / 2} cy={h * 0.93} rx={w * 0.40} ry={h * 0.045} fill={theme.accentDeep} opacity="0.25" />
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
      <Path
        d={`M ${w * 0.25} ${h * 0.25}
            Q ${w * 0.5} ${h * 0.16}, ${w * 0.75} ${h * 0.25}
            L ${w * 0.73} ${h * 0.42}
            Q ${w * 0.5} ${h * 0.36}, ${w * 0.27} ${h * 0.42} Z`}
        fill={`url(#creamGrad-${slug})`}
      />
      <Path
        d={`M ${w * 0.30} ${h * 0.27} Q ${w * 0.5} ${h * 0.21}, ${w * 0.70} ${h * 0.27}`}
        stroke="#FFFFFF"
        strokeWidth={1.2}
        opacity="0.7"
        fill="none"
      />
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
      {slug === "gold" && (
        <Path
          d={`M ${w * 0.25} ${h * 0.25} Q ${w * 0.5} ${h * 0.18}, ${w * 0.75} ${h * 0.25}`}
          stroke="#FFD56B"
          strokeWidth={2}
          opacity={0.85}
          fill="none"
        />
      )}
      {slug === "silver" && (
        <G opacity={0.45} stroke={theme.cupGlass} strokeWidth={1.2} fill="none">
          <Path d={`M ${w * 0.45} ${h * 0.20} Q ${w * 0.50} ${h * 0.15}, ${w * 0.42} ${h * 0.08}`} />
          <Path d={`M ${w * 0.55} ${h * 0.20} Q ${w * 0.60} ${h * 0.15}, ${w * 0.58} ${h * 0.05}`} />
        </G>
      )}
      {slug === "bronze" && (
        <G opacity={0.35} stroke={theme.accentDeep} strokeWidth={1} fill="none">
          <Path d={`M ${w * 0.45} ${h * 0.20} Q ${w * 0.52} ${h * 0.12}, ${w * 0.45} ${h * 0.05}`} />
        </G>
      )}
    </Svg>
  );
}

function formatMul(m: number | string | null | undefined): string {
  const n = Number(m ?? 1);
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
