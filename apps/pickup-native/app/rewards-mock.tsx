/**
 * MOCK v3 — Proposed unified Rewards screen.
 *
 * No emojis anywhere. Every visual signal is a lucide icon in a
 * consistent 36×36 tile so the page reads as one design system.
 * Layout (top → bottom):
 *   1. Hero — next-tier progression
 *   2. Stat strip — Beans + streak (tier moved to hero, no more pill duplicate)
 *   3. NOW — bag + active mission (2-col grid)
 *   4. READY TO CLAIM — milestones + admin claimables (2-col grid)
 *   5. YOUR REWARDS — wallet rewards (2-col grid, all-link)
 *   6. ACHIEVEMENTS — milestone ladder (2-col grid, all-link)
 *   7. SPEND BEANS — points-shop catalog (horizontal rail)
 *
 * Each section renders only when populated.
 */

import { useState } from "react";
import { View, Text, ScrollView, Pressable, Modal } from "react-native";
import { Stack, router } from "expo-router";
import {
  ChevronRight, Sparkles, Flame, Trophy, Gift,
  Target, Check, Package, Award, Crown, Coffee, Cookie,
  Tag, Sandwich, Star,
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
    tierColor: "#D99404",
    tierMultiplier: 1.5,
  },
  nextTier: {
    name: "Platinum",
    visitsLeft: 8,
    visitsCurrent: 12,
    visitsTotal: 20,
    perksTease: "1.75× Beans + free monthly drink",
  },
  beanBag: {
    available: true,
    weeksAtQualify: 4,
    label: "House Bag",
    Icon: Package,
    bonusBeans: 75,
    voucherTitle: "RM5 Off",
  },
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
      reward: "2 rewards · +200 Beans",
      Icon: Trophy,
    },
  ],
  claimableAdmin: [
    {
      id: "a1",
      title: "Welcome BOGO",
      description: "Buy one drink, get one free",
      Icon: Gift,
    },
  ],
  yourRewards: [
    { id: "v1", title: "Free Drink",  sub: "From milestone", Icon: Coffee, dark: true  },
    { id: "v2", title: "RM5 Off",     sub: "Expires Apr 12", Icon: Tag,    dark: false },
    { id: "v3", title: "Free Add-on", sub: "Expires Apr 20", Icon: Gift,   dark: false },
    { id: "v4", title: "2× Beans",    sub: "From mystery",   Icon: Sparkles, dark: true },
  ],
  achievements: [
    {
      id: "ach1",
      title: "Outlet Explorer",
      progress: "2 / 3 outlets",
      earned: false,
      Icon: Target,
    },
    {
      id: "ach2",
      title: "Hot Streak",
      progress: "4 / 8 weeks",
      earned: false,
      Icon: Flame,
    },
    {
      id: "ach3",
      title: "First Sip",
      progress: "Earned · Mar 4",
      earned: true,
      Icon: Award,
    },
    {
      id: "ach4",
      title: "Bean Counter",
      progress: "Earned · Feb 18",
      earned: true,
      Icon: Trophy,
    },
  ],
  catalog: [
    { id: "r1", name: "Free Add-on", pts: 200,  Icon: Gift },
    { id: "r2", name: "RM5 Off",     pts: 500,  Icon: Tag },
    { id: "r3", name: "Free Pastry", pts: 800,  Icon: Cookie },
    { id: "r4", name: "Free Drink",  pts: 1200, Icon: Coffee },
    { id: "r5", name: "Free Lunch",  pts: 3000, Icon: Sandwich },
  ],
};

// Brand palette in one place so every card pulls from the same source.
const C = {
  bg:       "#F8F5F2",
  surface:  "#FFFFFF",
  surfaceWarm: "#FBEBE8",
  espresso: "#1A0200",
  border:   "#E5E5E5",
  primary:  "#C05040",
  gold:     "#FBBF24",
  mutedFg:  "#6B6B6B",
  faintFg:  "#8E8E93",
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
    setMissionState("no-active");
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <EspressoHeader title="Rewards" showCart={false} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <NextTierHero {...m.nextTier} tierName={m.member.tierName} tierColor={m.member.tierColor} />

        <StatStrip
          points={m.member.points}
          streakWeeks={m.member.streakWeeks}
        />

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

        {(m.claimableMilestones.length > 0 || m.claimableAdmin.length > 0) && (
          <Section label="Ready to claim" count={m.claimableMilestones.length + m.claimableAdmin.length}>
            <Grid2>
              {m.claimableMilestones.map((c) => (
                <ClaimCard key={c.id} Icon={c.Icon} title={c.title} subtitle={c.reward} kind="milestone" />
              ))}
              {m.claimableAdmin.map((c) => (
                <ClaimCard key={c.id} Icon={c.Icon} title={c.title} subtitle={c.description} kind="gift" />
              ))}
            </Grid2>
          </Section>
        )}

        <Section label="Your rewards" count={m.yourRewards.length} showAll>
          <Grid2>
            {m.yourRewards.map((v) => (
              <RewardCard key={v.id} Icon={v.Icon} title={v.title} sub={v.sub} dark={v.dark} />
            ))}
          </Grid2>
        </Section>

        <Section label="Achievements" count={m.achievements.length} showAll>
          <Grid2>
            {m.achievements.map((a) => (
              <AchievementCard key={a.id} Icon={a.Icon} title={a.title} progress={a.progress} earned={a.earned} />
            ))}
          </Grid2>
        </Section>

        <Section label="Spend Beans" count={m.catalog.length} showAll>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
            {m.catalog.map((r) => (
              <CatalogTicket key={r.id} Icon={r.Icon} name={r.name} pts={r.pts} balance={m.member.points} />
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

// ─── Hero ───────────────────────────────────────────────────────────

function NextTierHero({
  name, visitsLeft, visitsCurrent, visitsTotal, perksTease, tierName, tierColor,
}: {
  name: string;
  visitsLeft: number;
  visitsCurrent: number;
  visitsTotal: number;
  perksTease: string;
  tierName: string;
  tierColor: string;
}) {
  const pct = Math.min(1, visitsCurrent / Math.max(1, visitsTotal));
  return (
    <View
      style={{
        backgroundColor: C.espresso,
        borderRadius: 20,
        padding: 20,
        shadowColor: "#160800",
        shadowOpacity: 0.2,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      }}
    >
      {/* Top eyebrow row — current tier badge on the left, "Next tier" eyebrow on the right */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100, backgroundColor: tierColor }}>
          <Star size={12} color={C.espresso} strokeWidth={2.4} />
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: C.espresso, letterSpacing: 0.5 }}>
            {tierName.toUpperCase()}
          </Text>
        </View>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: C.gold, letterSpacing: 2, textTransform: "uppercase" }}>
          Next tier
        </Text>
      </View>

      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: "#FFFFFF", letterSpacing: -0.4 }}>
        {visitsLeft} {visitsLeft === 1 ? "visit" : "visits"} to {name}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>
        Last 90 days · {visitsCurrent}/{visitsTotal} visits
      </Text>

      <View style={{ height: 8, marginTop: 16, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
        <View style={{ height: "100%", width: `${Math.round(pct * 100)}%`, backgroundColor: C.gold, borderRadius: 4 }} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14 }}>
        <Sparkles size={13} color={C.gold} strokeWidth={2} />
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12, color: "rgba(255,255,255,0.65)" }} numberOfLines={1}>
          {perksTease}
        </Text>
      </View>
    </View>
  );
}

// ─── Stat strip ─────────────────────────────────────────────────────

function StatStrip({ points, streakWeeks }: { points: number; streakWeeks: number }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: C.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: C.border,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: C.faintFg, letterSpacing: 1.4, textTransform: "uppercase" }}>
          Beans
        </Text>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: C.espresso, letterSpacing: -0.5, lineHeight: 24, marginTop: 2 }}>
          {points.toLocaleString()}
        </Text>
      </View>
      <View style={{ width: 1, height: 32, backgroundColor: "rgba(26,2,0,0.08)" }} />
      <View style={{ flex: 1, paddingLeft: 16 }}>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: C.faintFg, letterSpacing: 1.4, textTransform: "uppercase" }}>
          Streak
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
          <Flame size={16} color={C.primary} strokeWidth={2.2} />
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 22, color: C.primary, letterSpacing: -0.3, lineHeight: 24 }}>
            {streakWeeks}
          </Text>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.primary, letterSpacing: 1 }}>
            WK
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Section header ─────────────────────────────────────────────────

function Section({ label, count, showAll, children }: { label: string; count?: number; showAll?: boolean; children: React.ReactNode }) {
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingHorizontal: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: C.espresso, letterSpacing: 1.8, textTransform: "uppercase" }}>
            {label}
          </Text>
          {count !== undefined && count > 0 && (
            <View style={{ paddingHorizontal: 6, height: 16, borderRadius: 8, backgroundColor: "rgba(192,80,64,0.12)", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10, color: C.primary }}>
                {count}
              </Text>
            </View>
          )}
        </View>
        {showAll && (
          <Pressable onPress={() => Haptics.selectionAsync()} className="active:opacity-70" style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: C.primary }}>
              All
            </Text>
            <ChevronRight size={12} color={C.primary} strokeWidth={2.4} />
          </Pressable>
        )}
      </View>
      {children}
    </View>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{children}</View>;
}

// ─── Card shells ────────────────────────────────────────────────────
//
// Two shells used everywhere:
//   - CardLight: cream/white surface, espresso text — for "passive"
//                state (locked, in-progress, regular wallet)
//   - CardDark:  espresso surface, gold accents — for actionable
//                state (claimable, mission-done, premium reward)
//
// Both expose the same anatomy: icon tile → label → body → optional
// action pill at the bottom. Strict consistency keeps the page from
// fragmenting into a parade of bespoke cards.

const CARD_W = "48%" as const;
const CARD_MIN_H = 142;

function CardLight({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        width: CARD_W,
        minHeight: CARD_MIN_H,
        padding: 12,
        borderRadius: 16,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      {children}
    </View>
  );
}

function CardDark({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        width: CARD_W,
        minHeight: CARD_MIN_H,
        padding: 12,
        borderRadius: 16,
        backgroundColor: C.espresso,
        borderWidth: 1,
        borderColor: C.espresso,
      }}
    >
      {children}
    </View>
  );
}

function IconTile({ Icon, dark, accent }: { Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>; dark?: boolean; accent?: string }) {
  const bg = dark ? "rgba(251,191,36,0.18)" : "rgba(192,80,64,0.10)";
  const color = accent ?? (dark ? C.gold : C.primary);
  return (
    <View
      style={{
        width: 36, height: 36, borderRadius: 10,
        backgroundColor: bg,
        alignItems: "center", justifyContent: "center",
      }}
    >
      <Icon size={18} color={color} strokeWidth={2} />
    </View>
  );
}

function CardEyebrow({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <Text style={{
      fontFamily: "SpaceGrotesk_700Bold",
      fontSize: 9.5,
      color: dark ? C.gold : C.primary,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginTop: 8,
    }}>
      {children}
    </Text>
  );
}

function CardTitle({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: "Peachi-Bold",
        fontSize: 14,
        color: dark ? "#FFFFFF" : C.espresso,
        marginTop: 2,
      }}
      numberOfLines={1}
    >
      {children}
    </Text>
  );
}

function CardSub({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <Text
      style={{
        fontFamily: "SpaceGrotesk_500Medium",
        fontSize: 11,
        color: dark ? "rgba(255,255,255,0.6)" : C.mutedFg,
        marginTop: 2,
      }}
      numberOfLines={2}
    >
      {children}
    </Text>
  );
}

function CardActionPill({
  label, dark, onPress,
}: {
  label: string;
  dark?: boolean;
  onPress?: () => void;
}) {
  const bg = dark ? C.gold : C.espresso;
  const fg = dark ? C.espresso : "#FFFFFF";
  return (
    <Pressable
      onPress={onPress}
      className="active:opacity-85"
      style={{
        marginTop: "auto",
        paddingVertical: 7,
        borderRadius: 100,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
      }}
    >
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: fg }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Now cards ──────────────────────────────────────────────────────

function BagCard({
  available, weeksAtQualify, label, Icon, bonusBeans, voucherTitle,
}: {
  available: boolean;
  weeksAtQualify: number;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  bonusBeans: number;
  voucherTitle: string | null;
}) {
  if (!available) {
    return (
      <CardLight>
        <IconTile Icon={Flame} />
        <CardEyebrow>Streak</CardEyebrow>
        <CardTitle>Build your streak</CardTitle>
        <CardSub>Order once a week to unlock a bag</CardSub>
      </CardLight>
    );
  }
  const sub = [bonusBeans > 0 ? `+${bonusBeans} Beans` : null, voucherTitle].filter(Boolean).join(" · ");
  return (
    <CardDark>
      <IconTile Icon={Icon} dark />
      <CardEyebrow dark>Wk {weeksAtQualify} bag</CardEyebrow>
      <CardTitle dark>{label}</CardTitle>
      <CardSub dark>{sub}</CardSub>
      <CardActionPill label="Open bag" dark />
    </CardDark>
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
  // 1) No mission picked — light card with dashed terracotta border.
  if (state === "no-active") {
    return (
      <Pressable
        onPress={() => {
          Haptics.selectionAsync();
          router.push("/mission-picker" as never);
        }}
        className="active:opacity-85"
        style={{
          width: CARD_W,
          minHeight: CARD_MIN_H,
          padding: 12,
          borderRadius: 16,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.primary,
          borderStyle: "dashed",
        }}
      >
        <IconTile Icon={Target} />
        <CardEyebrow>Challenge</CardEyebrow>
        <CardTitle>Pick this week</CardTitle>
        <CardSub>Earn rewards by Sunday</CardSub>
      </Pressable>
    );
  }

  // 2) Mission complete but reward not yet claimed — dark card + gold pill.
  if (state === "complete-unclaimed") {
    return (
      <CardDark>
        <IconTile Icon={Check} dark />
        <CardEyebrow dark>Mission done</CardEyebrow>
        <CardTitle dark>{title}</CardTitle>
        <CardSub dark>{rewardChips.join(" · ")}</CardSub>
        <CardActionPill label="Claim reward" dark onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onClaim?.();
        }} />
      </CardDark>
    );
  }

  // 3) In progress — light card with terracotta progress bar.
  const pct = Math.min(1, progressCurrent / Math.max(1, progressTarget));
  return (
    <CardLight>
      <IconTile Icon={Target} />
      <CardEyebrow>Active</CardEyebrow>
      <CardTitle>{title}</CardTitle>
      <CardSub>{rewardChips.join(" · ")}</CardSub>
      <View style={{ marginTop: "auto" }}>
        <View style={{ height: 5, borderRadius: 3, backgroundColor: "rgba(192,80,64,0.12)", overflow: "hidden" }}>
          <View style={{ height: "100%", width: `${Math.round(pct * 100)}%`, backgroundColor: C.primary, borderRadius: 3 }} />
        </View>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.primary, marginTop: 6, letterSpacing: 1 }}>
          {progressCurrent}/{progressTarget}
        </Text>
      </View>
    </CardLight>
  );
}

// ─── Claim card ─────────────────────────────────────────────────────

function ClaimCard({
  Icon, title, subtitle, kind,
}: {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  title: string;
  subtitle: string;
  kind: "milestone" | "gift";
}) {
  return (
    <CardDark>
      <IconTile Icon={Icon} dark />
      <CardEyebrow dark>{kind === "milestone" ? "Milestone" : "Gift"}</CardEyebrow>
      <CardTitle dark>{title}</CardTitle>
      <CardSub dark>{subtitle}</CardSub>
      <CardActionPill label={kind === "milestone" ? "Claim reward" : "Claim"} dark />
    </CardDark>
  );
}

// ─── Reward card (wallet) ───────────────────────────────────────────

function RewardCard({
  Icon, title, sub, dark,
}: {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  title: string;
  sub: string;
  dark: boolean;
}) {
  return dark ? (
    <CardDark>
      <IconTile Icon={Icon} dark />
      <CardEyebrow dark>Reward</CardEyebrow>
      <CardTitle dark>{title}</CardTitle>
      <CardSub dark>{sub}</CardSub>
      <CardActionPill label="Use" dark />
    </CardDark>
  ) : (
    <CardLight>
      <IconTile Icon={Icon} />
      <CardEyebrow>Reward</CardEyebrow>
      <CardTitle>{title}</CardTitle>
      <CardSub>{sub}</CardSub>
      <CardActionPill label="Use" />
    </CardLight>
  );
}

// ─── Achievement card ───────────────────────────────────────────────

function AchievementCard({
  Icon, title, progress, earned,
}: {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  title: string;
  progress: string;
  earned: boolean;
}) {
  if (earned) {
    return (
      <CardDark>
        <IconTile Icon={Icon} dark />
        <CardEyebrow dark>Earned</CardEyebrow>
        <CardTitle dark>{title}</CardTitle>
        <CardSub dark>{progress}</CardSub>
      </CardDark>
    );
  }
  return (
    <CardLight>
      <IconTile Icon={Icon} />
      <CardEyebrow>In progress</CardEyebrow>
      <CardTitle>{title}</CardTitle>
      <CardSub>{progress}</CardSub>
    </CardLight>
  );
}

// ─── Catalog ticket ─────────────────────────────────────────────────

function CatalogTicket({
  Icon, name, pts, balance,
}: {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  name: string;
  pts: number;
  balance: number;
}) {
  const affordable = balance >= pts;
  return (
    <View
      style={{
        width: 132,
        padding: 12,
        borderRadius: 16,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View style={{ height: 60, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(192,80,64,0.10)", alignItems: "center", justifyContent: "center" }}>
          <Icon size={22} color={C.primary} strokeWidth={2} />
        </View>
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13, color: C.espresso, marginTop: 4 }} numberOfLines={2}>
        {name}
      </Text>
      <View
        style={{
          marginTop: 6,
          paddingVertical: 5,
          borderRadius: 100,
          backgroundColor: affordable ? C.espresso : "rgba(26,2,0,0.06)",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: affordable ? C.gold : C.faintFg, letterSpacing: 0.4 }}>
          {pts.toLocaleString()} pts
        </Text>
      </View>
    </View>
  );
}

// ─── Mission claim celebration ──────────────────────────────────────

function MissionClaimCelebration({
  title, rewardChips, onClose,
}: {
  title: string;
  rewardChips: string[];
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: "100%", maxWidth: 360,
            borderRadius: 24,
            backgroundColor: C.espresso,
            padding: 24,
            alignItems: "center",
            shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
          }}
        >
          <View
            style={{
              width: 86, height: 86, borderRadius: 43,
              backgroundColor: "rgba(251,191,36,0.18)",
              alignItems: "center", justifyContent: "center",
              marginBottom: 14,
              borderWidth: 1, borderColor: "rgba(251,191,36,0.4)",
            }}
          >
            <Target size={40} color={C.gold} strokeWidth={1.8} />
          </View>

          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.gold, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
            Mission complete
          </Text>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 24, color: "#FFFFFF", letterSpacing: -0.3, textAlign: "center" }} numberOfLines={2}>
            {title}
          </Text>

          <View style={{ alignSelf: "stretch", marginTop: 18, borderTopWidth: 1, borderTopColor: "rgba(251,191,36,0.15)", paddingTop: 14, gap: 8 }}>
            {rewardChips.map((chip, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Gift size={16} color={C.gold} strokeWidth={2} />
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
              style={{ backgroundColor: C.gold, borderRadius: 100, paddingVertical: 13, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: C.espresso }}>
                Got it
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
