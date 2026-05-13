/**
 * MOCK — Proposed unified Rewards screen.
 *
 * Static layout + mock data so we can iterate on the design before
 * touching the live rewards screen. Navigate to /rewards-mock in the
 * app to preview.
 *
 * Layout (top → bottom):
 *   1. Espresso header
 *   2. Hero — next-tier progression card (was on Milestones tab)
 *   3. Stat strip — Beans · streak · tier in one row
 *   4. NOW — bag + active mission (2-col grid, max 2 cards)
 *   5. READY TO CLAIM — milestones + admin claimables (2-col grid)
 *   6. YOUR REWARDS — wallet vouchers (2-col grid, all-link)
 *   7. ACHIEVEMENTS — milestone ladder (2-col grid, all-link)
 *   8. SPEND BEANS — points-shop catalog (horizontal rail)
 *
 * Each section renders ONLY when there's content for it, so a fresh
 * customer doesn't see five empty strips on first launch.
 */

import { useState } from "react";
import { View, Text, ScrollView, Pressable, Modal } from "react-native";
import { Stack, router } from "expo-router";
import {
  ChevronRight, Sparkles, Flame, Trophy, Gift,
  Target, Check,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { BottomNav } from "../components/BottomNav";
import { EspressoHeader } from "../components/EspressoHeader";

// ─── Mock data ──────────────────────────────────────────────────────

const MOCK = {
  member: {
    points: 2314,
    streakWeeks: 4,
    longestWeeks: 7,
    tierName: "Gold",
    tierIcon: "★",
    tierColor: "#D99404",
    tierMultiplier: 1.5,
  },
  nextTier: {
    name: "Platinum",
    qualification: "visits" as const,
    visitsLeft: 8,
    visitsCurrent: 12,
    visitsTotal: 20,
    perksTease: "1.75× Beans + free monthly drink",
  },
  beanBag: {
    available: true,
    weeksAtQualify: 4,
    label: "House Bag",
    emoji: "🛍️",
    bonusBeans: 75,
    voucherTitle: "RM5 Off",
  },
  // Mission demo: showing the NEW "complete-unclaimed" state so you
  // can see the proposed claim flow. Tap "Claim reward" to trigger
  // the celebration modal. After dismissing, this card would fall
  // back to the "Pick this week's challenge" state until the
  // customer picks a new mission.
  mission: {
    state: "complete-unclaimed" as "active" | "complete-unclaimed" | "no-active",
    title: "Group Order",
    progressCurrent: 3,
    progressTarget: 3,
    rewardChips: ["Free Pastry", "+30 Beans"],
  },
  claimableMilestones: [
    {
      id: "m1",
      title: "Coffee Veteran",
      reward: "2 vouchers · +200 Beans",
      emoji: "🏆",
    },
  ],
  claimableAdmin: [
    {
      id: "a1",
      title: "Welcome BOGO",
      description: "Buy one drink, get one free",
      emoji: "🎁",
    },
  ],
  // Capped at 4 — claimables surface higher up in "Ready to claim",
  // so this section shows only "Yours" (active wallet vouchers).
  yourVouchers: [
    { id: "v1", title: "Free Drink",  sub: "From milestone", accent: "#FBBF24", bg: "#1A0200", fg: "#FFFFFF" },
    { id: "v2", title: "RM5 Off",     sub: "Expires Apr 12", accent: "#C05040", bg: "#FBEBE8", fg: "#1A0200" },
    { id: "v3", title: "Free Add-on", sub: "Expires Apr 20", accent: "#C05040", bg: "#FBEBE8", fg: "#1A0200" },
    { id: "v4", title: "2× Beans",    sub: "From mystery",   accent: "#FBBF24", bg: "#1A0200", fg: "#FFFFFF" },
  ],
  // Capped at 4 — prioritise in-progress first (closest to threshold),
  // then earned. Claimable milestones surface in "Ready to claim"
  // above, not here.
  achievements: [
    {
      id: "ach1",
      title: "Outlet Explorer",
      progress: "2 / 3 outlets · 1 to go",
      earned: false,
      emoji: "🏙",
    },
    {
      id: "ach2",
      title: "Hot Streak",
      progress: "4 / 8 weeks · halfway there",
      earned: false,
      emoji: "🔥",
    },
    {
      id: "ach3",
      title: "First Sip",
      progress: "Earned · Mar 4",
      earned: true,
      emoji: "🥉",
    },
    {
      id: "ach4",
      title: "Bean Counter",
      progress: "Earned · Feb 18",
      earned: true,
      emoji: "🪙",
    },
  ],
  catalog: [
    { id: "r1", name: "Free Add-on",   pts: 200,  emoji: "☕" },
    { id: "r2", name: "RM5 Voucher",   pts: 500,  emoji: "💵" },
    { id: "r3", name: "Free Pastry",   pts: 800,  emoji: "🥐" },
    { id: "r4", name: "Free Drink",    pts: 1200, emoji: "🥤" },
    { id: "r5", name: "Free Lunch",    pts: 3000, emoji: "🍝" },
  ],
};

// ─── Screen ─────────────────────────────────────────────────────────

export default function RewardsMock() {
  const m = MOCK;
  const [missionCelebration, setMissionCelebration] = useState(false);
  const [missionState, setMissionState] = useState(m.mission.state);

  function claimMission() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMissionCelebration(true);
  }

  function closeMissionCelebration() {
    setMissionCelebration(false);
    // After claiming, mission cycle resets — card flips back to the
    // "pick this week's challenge" prompt.
    setMissionState("no-active");
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Rewards" showCart={false} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 18 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 1. Hero — next-tier progression ────────────────────── */}
        <NextTierHero {...m.nextTier} tierColor={m.member.tierColor} />

        {/* ── 2. Stat strip ──────────────────────────────────────── */}
        <StatStrip
          points={m.member.points}
          streakWeeks={m.member.streakWeeks}
          tierName={m.member.tierName}
          tierMultiplier={m.member.tierMultiplier}
          tierColor={m.member.tierColor}
        />

        {/* ── 3. NOW — actionable this week ──────────────────────── */}
        <Section label="Now">
          <Grid2>
            <BagCard {...m.beanBag} />
            <MissionCard
              state={missionState}
              title={m.mission.title}
              progressCurrent={m.mission.progressCurrent}
              progressTarget={m.mission.progressTarget}
              rewardChips={m.mission.rewardChips}
              onClaim={claimMission}
            />
          </Grid2>
        </Section>

        {/* ── 4. READY TO CLAIM ──────────────────────────────────── */}
        {(m.claimableMilestones.length > 0 || m.claimableAdmin.length > 0) && (
          <Section label="Ready to claim" count={m.claimableMilestones.length + m.claimableAdmin.length}>
            <Grid2>
              {m.claimableMilestones.map((c) => (
                <ClaimCard
                  key={c.id}
                  emoji={c.emoji}
                  title={c.title}
                  subtitle={c.reward}
                  variant="milestone"
                />
              ))}
              {m.claimableAdmin.map((c) => (
                <ClaimCard
                  key={c.id}
                  emoji={c.emoji}
                  title={c.title}
                  subtitle={c.description}
                  variant="gift"
                />
              ))}
            </Grid2>
          </Section>
        )}

        {/* ── 5. YOUR REWARDS — wallet vouchers ──────────────────── */}
        <Section label="Your rewards" count={m.yourVouchers.length} showAll>
          <Grid2>
            {m.yourVouchers.map((v) => (
              <VoucherCard key={v.id} title={v.title} sub={v.sub} bg={v.bg} fg={v.fg} accent={v.accent} />
            ))}
          </Grid2>
        </Section>

        {/* ── 6. ACHIEVEMENTS — milestone ladder ─────────────────── */}
        <Section label="Achievements" count={m.achievements.length} showAll>
          <Grid2>
            {m.achievements.map((a) => (
              <AchievementCard
                key={a.id}
                emoji={a.emoji}
                title={a.title}
                progress={a.progress}
                earned={a.earned}
              />
            ))}
          </Grid2>
        </Section>

        {/* ── 7. SPEND BEANS — horizontal rail ───────────────────── */}
        <Section label="Spend Beans" count={m.catalog.length} showAll>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingRight: 4 }}
          >
            {m.catalog.map((r) => (
              <CatalogTicket key={r.id} name={r.name} pts={r.pts} emoji={r.emoji} balance={m.member.points} />
            ))}
          </ScrollView>
        </Section>
      </ScrollView>

      <BottomNav />

      {missionCelebration && (
        <MissionClaimCelebration
          title={m.mission.title}
          rewardChips={m.mission.rewardChips}
          onClose={closeMissionCelebration}
        />
      )}
    </View>
  );
}

// ─── Components ────────────────────────────────────────────────────

function NextTierHero({
  name, qualification, visitsLeft, visitsCurrent, visitsTotal, perksTease, tierColor,
}: {
  name: string;
  qualification: "visits" | "spend";
  visitsLeft: number;
  visitsCurrent: number;
  visitsTotal: number;
  perksTease: string;
  tierColor: string;
}) {
  const pct = Math.min(1, visitsCurrent / Math.max(1, visitsTotal));
  return (
    <View
      className="rounded-2xl"
      style={{
        backgroundColor: "#1A0200",
        padding: 18,
        shadowColor: "#160800",
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      }}
    >
      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#FBBF24", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
        Next tier
      </Text>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: "#FBBF24", letterSpacing: -0.3 }}>
        {visitsLeft} {visitsLeft === 1 ? "visit" : "visits"} to {name}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
        Last 90 days · {visitsCurrent} of {visitsTotal} visits
      </Text>

      <View style={{ height: 8, marginTop: 14, borderRadius: 4, backgroundColor: "rgba(251,191,36,0.15)", overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${Math.round(pct * 100)}%`, backgroundColor: "#FBBF24", borderRadius: 4 }} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 }}>
        <Sparkles size={13} color="#FBBF24" strokeWidth={2} />
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 12, color: "rgba(255,255,255,0.85)" }}>
          {name}
        </Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
          unlocks {perksTease}
        </Text>
      </View>
    </View>
  );
}

function StatStrip({
  points, streakWeeks, tierName, tierMultiplier, tierColor,
}: {
  points: number;
  streakWeeks: number;
  tierName: string;
  tierMultiplier: number;
  tierColor: string;
}) {
  return (
    <View
      className="rounded-2xl bg-surface border border-border"
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 14,
        shadowColor: "#000",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: "#8E8E93", letterSpacing: 1.4, textTransform: "uppercase" }}>
          Beans
        </Text>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: "#1A0200", letterSpacing: -0.5, lineHeight: 24, marginTop: 2 }}>
          {points.toLocaleString()}
        </Text>
      </View>
      <View style={{ width: 1, height: 32, backgroundColor: "rgba(26,2,0,0.08)" }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: "#8E8E93", letterSpacing: 1.4, textTransform: "uppercase" }}>
          Streak
        </Text>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 2 }}>
          <Flame size={14} color="#C05040" strokeWidth={2.2} />
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 18, color: "#C05040", letterSpacing: -0.3 }}>
            {streakWeeks}
          </Text>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#C05040", letterSpacing: 1 }}>
            WK
          </Text>
        </View>
      </View>
      <View style={{ width: 1, height: 32, backgroundColor: "rgba(26,2,0,0.08)" }} />
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/tier-benefits" as never);
        }}
        className="active:opacity-80"
        style={{
          paddingLeft: 10,
          paddingRight: 10,
          paddingVertical: 6,
          borderRadius: 100,
          backgroundColor: tierColor,
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Text style={{ fontSize: 12 }}>★</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: "#1A0200", letterSpacing: 1 }}>
          {tierName.toUpperCase()} {tierMultiplier}×
        </Text>
      </Pressable>
    </View>
  );
}

function Section({
  label, count, showAll, children,
}: {
  label: string;
  count?: number;
  showAll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: "#1A0200", letterSpacing: 1.8, textTransform: "uppercase" }}>
            {label}
          </Text>
          {count !== undefined && count > 0 && (
            <View
              style={{
                paddingHorizontal: 6, height: 16, borderRadius: 8,
                backgroundColor: "rgba(192,80,64,0.12)",
                alignItems: "center", justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: "#C05040" }}>
                {count}
              </Text>
            </View>
          )}
        </View>
        {showAll && (
          <Pressable onPress={() => Haptics.selectionAsync()} className="active:opacity-70" style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: "#C05040" }}>
              All
            </Text>
            <ChevronRight size={12} color="#C05040" strokeWidth={2.4} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {children}
    </View>
  );
}

// Reusable shell so every grid card has the same width/height
function GridCard({
  children,
  bg = "#FFFFFF",
  border = "#E5E5E5",
}: {
  children: React.ReactNode;
  bg?: string;
  border?: string;
}) {
  return (
    <View
      style={{
        width: "48%",
        minHeight: 138,
        padding: 12,
        borderRadius: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      {children}
    </View>
  );
}

function BagCard({
  available, weeksAtQualify, label, emoji, bonusBeans, voucherTitle,
}: {
  available: boolean;
  weeksAtQualify: number;
  label: string;
  emoji: string;
  bonusBeans: number;
  voucherTitle: string | null;
}) {
  if (!available) {
    return (
      <GridCard bg="#FBEBE8" border="rgba(192,80,64,0.25)">
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(192,80,64,0.18)", alignItems: "center", justifyContent: "center" }}>
          <Flame size={18} color="#C05040" strokeWidth={2} />
        </View>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#1A0200", marginTop: 8 }}>
          Build your streak
        </Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "#6B6B6B", marginTop: 2 }} numberOfLines={2}>
          Order once a week to unlock a bean bag
        </Text>
      </GridCard>
    );
  }
  const chips: string[] = [];
  if (bonusBeans > 0) chips.push(`+${bonusBeans} Beans`);
  if (voucherTitle)   chips.push(voucherTitle);
  return (
    <View
      style={{
        width: "48%",
        minHeight: 138,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "#1A0200",
        borderWidth: 1,
        borderColor: "#1A0200",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 22 }}>{emoji}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: "#FBBF24", letterSpacing: 1.4, textTransform: "uppercase" }}>
          Wk {weeksAtQualify} bag
        </Text>
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#FFFFFF", marginTop: 8 }} numberOfLines={1}>
        {label}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 }} numberOfLines={2}>
        {chips.join(" · ")}
      </Text>
      <View
        style={{
          marginTop: "auto",
          backgroundColor: "#FBBF24",
          borderRadius: 100,
          paddingVertical: 7,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: "#1A0200" }}>
          Open bag
        </Text>
      </View>
    </View>
  );
}

function MissionCard({
  state, title, progressCurrent, progressTarget, rewardChips, onClaim,
}: {
  state: "active" | "complete-unclaimed" | "no-active";
  title: string;
  progressCurrent: number;
  progressTarget: number;
  rewardChips: string[];
  onClaim?: () => void;
}) {
  // No mission picked — dashed-terracotta CTA pulling the customer
  // into the mission picker.
  if (state === "no-active") {
    return (
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/mission-picker" as never);
        }}
        className="active:opacity-85"
        style={{
          width: "48%",
          minHeight: 138,
          padding: 12,
          borderRadius: 16,
          backgroundColor: "#FFFFFF",
          borderWidth: 1,
          borderColor: "#C05040",
          borderStyle: "dashed",
        }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#FBEBE8", alignItems: "center", justifyContent: "center" }}>
          <Target size={18} color="#C05040" strokeWidth={2} />
        </View>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#1A0200", marginTop: 8 }}>
          Pick this week's challenge
        </Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "#6B6B6B", marginTop: 2 }} numberOfLines={2}>
          Earn voucher rewards by Sunday
        </Text>
      </Pressable>
    );
  }

  // Mission complete but reward not claimed — espresso card with a
  // chunky gold "Claim reward" pill. Mirrors the bean-bag and
  // milestone claim language so wins read as one family.
  if (state === "complete-unclaimed") {
    return (
      <View
        style={{
          width: "48%",
          minHeight: 138,
          padding: 12,
          borderRadius: 16,
          backgroundColor: "#1A0200",
          borderWidth: 1,
          borderColor: "#1A0200",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 22, height: 22, borderRadius: 11,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Check size={14} color="#FBBF24" strokeWidth={2.6} />
          </View>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: "#FBBF24", letterSpacing: 1.4, textTransform: "uppercase" }}>
            Mission done
          </Text>
        </View>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#FFFFFF", marginTop: 8 }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 }} numberOfLines={2}>
          {rewardChips.join(" · ")}
        </Text>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onClaim?.();
          }}
          className="active:opacity-85"
          style={{
            marginTop: "auto",
            backgroundColor: "#FBBF24",
            borderRadius: 100,
            paddingVertical: 7,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: "#1A0200" }}>
            Claim reward
          </Text>
        </Pressable>
      </View>
    );
  }

  // Active in-progress — white card with terracotta progress bar.
  const pct = Math.min(1, progressCurrent / Math.max(1, progressTarget));
  return (
    <GridCard>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Target size={16} color="#C05040" strokeWidth={2} />
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: "#C05040", letterSpacing: 1.4, textTransform: "uppercase" }}>
          Active mission
        </Text>
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#1A0200", marginTop: 8 }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "#6B6B6B", marginTop: 2 }} numberOfLines={1}>
        {rewardChips.join(" · ")}
      </Text>
      <View style={{ height: 5, marginTop: 10, borderRadius: 3, backgroundColor: "rgba(192,80,64,0.12)", overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${Math.round(pct * 100)}%`, backgroundColor: "#C05040", borderRadius: 3 }} />
      </View>
      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: "#C05040", marginTop: 6, letterSpacing: 1 }}>
        {progressCurrent} / {progressTarget}
      </Text>
    </GridCard>
  );
}

// Celebration modal fired when the customer taps "Claim reward" on a
// completed mission card. Mirrors the bean-bag / milestone celebration
// language: espresso surface, gold trophy badge, reward list, single
// "Got it" CTA. After dismiss, the mission card flips to the "Pick
// this week's challenge" state.
function MissionClaimCelebration({
  title, rewardChips, onClose,
}: {
  title: string;
  rewardChips: string[];
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.65)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 360,
            borderRadius: 24,
            backgroundColor: "#1A0200",
            padding: 24,
            alignItems: "center",
            shadowColor: "#000",
            shadowOpacity: 0.4,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
          }}
        >
          <View
            style={{
              width: 86, height: 86, borderRadius: 43,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignItems: "center", justifyContent: "center",
              marginBottom: 14,
              borderWidth: 1,
              borderColor: "rgba(251,191,36,0.4)",
            }}
          >
            <Target size={40} color="#FBBF24" strokeWidth={1.8} />
          </View>

          <Text style={{
            fontFamily: "SpaceGrotesk_700Bold",
            fontSize: 10.5, color: "#FBBF24",
            letterSpacing: 2, textTransform: "uppercase", marginBottom: 4,
          }}>
            Mission complete
          </Text>
          <Text
            style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: "#FFFFFF", letterSpacing: -0.3, textAlign: "center" }}
            numberOfLines={2}
          >
            {title}
          </Text>

          <View style={{ alignSelf: "stretch", marginTop: 18, borderTopWidth: 1, borderTopColor: "rgba(251,191,36,0.15)", paddingTop: 14, gap: 8 }}>
            {rewardChips.map((chip, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Gift size={16} color="#FBBF24" strokeWidth={2} />
                <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(255,255,255,0.92)" }} numberOfLines={1}>
                  {chip}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ alignSelf: "stretch", marginTop: 22 }}>
            <Pressable
              onPress={onClose}
              className="active:opacity-85"
              style={{ backgroundColor: "#FBBF24", borderRadius: 100, paddingVertical: 13, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#1A0200" }}>
                Got it
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ClaimCard({
  emoji, title, subtitle, variant,
}: {
  emoji: string;
  title: string;
  subtitle: string;
  variant: "milestone" | "gift";
}) {
  const accent = "#FBBF24";
  return (
    <View
      style={{
        width: "48%",
        minHeight: 138,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "#1A0200",
        borderWidth: 1,
        borderColor: "#1A0200",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: accent, letterSpacing: 1.4, textTransform: "uppercase" }}>
          {variant === "milestone" ? "Milestone" : "Gift"}
        </Text>
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: "#FFFFFF", marginTop: 8 }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 2 }} numberOfLines={2}>
        {subtitle}
      </Text>
      <View
        style={{
          marginTop: "auto",
          backgroundColor: accent,
          borderRadius: 100,
          paddingVertical: 7,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: "#1A0200" }}>
          {variant === "milestone" ? "Claim reward" : "Claim"}
        </Text>
      </View>
    </View>
  );
}

function VoucherCard({
  title, sub, bg, fg, accent,
}: {
  title: string;
  sub: string;
  bg: string;
  fg: string;
  accent: string;
}) {
  return (
    <View
      style={{
        width: "48%",
        minHeight: 138,
        padding: 12,
        borderRadius: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: bg === "#1A0200" ? "#1A0200" : "rgba(26,2,0,0.08)",
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: bg === "#1A0200" ? "rgba(251,191,36,0.18)" : "rgba(192,80,64,0.15)", alignItems: "center", justifyContent: "center" }}>
        <Gift size={18} color={accent} strokeWidth={2} />
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: fg, marginTop: 8 }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: bg === "#1A0200" ? "rgba(255,255,255,0.6)" : "#6B6B6B", marginTop: 2 }} numberOfLines={1}>
        {sub}
      </Text>
      <View
        style={{
          marginTop: "auto",
          paddingVertical: 7,
          borderRadius: 100,
          alignItems: "center",
          backgroundColor: bg === "#1A0200" ? "rgba(255,255,255,0.10)" : "#1A0200",
        }}
      >
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: bg === "#1A0200" ? "#FBBF24" : "#FFFFFF" }}>
          Use
        </Text>
      </View>
    </View>
  );
}

function AchievementCard({
  emoji, title, progress, earned,
}: {
  emoji: string;
  title: string;
  progress: string;
  earned: boolean;
}) {
  return (
    <View
      style={{
        width: "48%",
        minHeight: 138,
        padding: 12,
        borderRadius: 16,
        backgroundColor: earned ? "#1A0200" : "#FFFFFF",
        borderWidth: 1,
        borderColor: earned ? "#1A0200" : "#E5E5E5",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
        <Trophy size={14} color={earned ? "#FBBF24" : "#8E8E93"} strokeWidth={2} />
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: earned ? "#FFFFFF" : "#1A0200", marginTop: 8 }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11, color: earned ? "rgba(255,255,255,0.6)" : "#6B6B6B", marginTop: 2 }} numberOfLines={2}>
        {progress}
      </Text>
      <Text
        style={{
          marginTop: "auto",
          fontFamily: "SpaceGrotesk_700Bold",
          fontSize: 9.5,
          color: earned ? "#FBBF24" : "#C05040",
          letterSpacing: 1.2,
          textTransform: "uppercase",
        }}
      >
        {earned ? "● Earned" : "In progress"}
      </Text>
    </View>
  );
}

function CatalogTicket({
  name, pts, emoji, balance,
}: {
  name: string;
  pts: number;
  emoji: string;
  balance: number;
}) {
  const affordable = balance >= pts;
  return (
    <View
      style={{
        width: 124,
        padding: 12,
        borderRadius: 16,
        backgroundColor: "#FFFFFF",
        borderWidth: 1,
        borderColor: "#E5E5E5",
        gap: 4,
      }}
    >
      <View style={{ height: 56, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 32 }}>{emoji}</Text>
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13, color: "#1A0200" }} numberOfLines={2}>
        {name}
      </Text>
      <View
        style={{
          marginTop: 4,
          paddingVertical: 5,
          borderRadius: 100,
          backgroundColor: affordable ? "#1A0200" : "rgba(26,2,0,0.06)",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: affordable ? "#FBBF24" : "#8E8E93", letterSpacing: 0.4 }}>
          {pts.toLocaleString()} pts
        </Text>
      </View>
    </View>
  );
}
