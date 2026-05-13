/**
 * MOCK v4 — Proposed unified Rewards screen.
 *
 * Every reward card surfaces the same four pieces of information so
 * customers know exactly where they stand at a glance:
 *
 *   1. OFFER       — what they get ("Free Drink", "+75 Beans + RM5 Off")
 *   2. HOW TO GET  — implicit in the action pill ("Use", "Claim",
 *                    "Open bag", "Spend N Beans") or in the progress
 *                    indicator for locked rewards
 *   3. CONSTRAINT  — expiry / points cost / threshold ("Expires Apr 12",
 *                    "1200 Beans", "50 lifetime orders")
 *   4. STATUS      — a small dot in the top-right of every card:
 *                    🟢 Ready  /  ⚪ Locked  /  🟡 Earned
 *
 * Two card surfaces:
 *   - Dark (espresso) → READY-TO-CLAIM state — gold pill, high prominence
 *   - Light (white)   → LOCKED state — progress bar instead of pill
 *
 * Layout:
 *   1. Hero — next-tier progression
 *   2. Stat strip — Beans + streak
 *   3. Continuous card stream (no section labels)
 *      • Bag + mission
 *      • Claimables
 *      • Wallet rewards
 *      • Achievements (locked + earned)
 *      • Catalog (horizontal rail)
 */

import { useState } from "react";
import { View, Text, ScrollView, Pressable, Modal } from "react-native";
import { Stack, router } from "expo-router";
import {
  ChevronRight, Sparkles, Flame, Trophy, Gift,
  Target, Check, Package, Award, Coffee, Cookie,
  Tag, Sandwich, Star, Clock,
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
    offer: "+75 Beans + RM5 Off",
    constraint: "Expires in 7 days",
  },
  mission: {
    state: "complete-unclaimed" as "active" | "complete-unclaimed" | "no-active",
    title: "Group Order",
    offer: "Free Pastry + 30 Beans",
    progressCurrent: 3,
    progressTarget: 3,
  },
  claimableMilestones: [
    {
      id: "m1",
      title: "Coffee Veteran",
      offer: "+200 Beans + 2 rewards",
      constraint: "50 lifetime orders",
      Icon: Trophy,
    },
  ],
  claimableAdmin: [
    {
      id: "a1",
      title: "Welcome BOGO",
      offer: "Buy one, get one free",
      constraint: "Expires Apr 30",
      Icon: Gift,
    },
  ],
  yourRewards: [
    { id: "v1", title: "Free Drink",  offer: "Any drink at checkout", constraint: "From milestone · No expiry",  Icon: Coffee },
    { id: "v2", title: "RM5 Off",     offer: "RM5 off your order",     constraint: "Expires Apr 12",              Icon: Tag    },
    { id: "v3", title: "Free Add-on", offer: "Any free add-on",         constraint: "Expires Apr 20",              Icon: Gift   },
    { id: "v4", title: "2× Beans",    offer: "Double points",           constraint: "From mystery · 1 use",        Icon: Sparkles },
  ],
  achievements: [
    {
      id: "ach1",
      title: "Outlet Explorer",
      offer: "+100 Beans + Add-on voucher",
      constraint: "3 distinct outlets",
      progressCurrent: 2,
      progressTarget: 3,
      progressUnit: "outlets",
      earned: false,
      Icon: Target,
    },
    {
      id: "ach2",
      title: "Hot Streak",
      offer: "+200 Beans + Free drink",
      constraint: "8-week streak",
      progressCurrent: 4,
      progressTarget: 8,
      progressUnit: "weeks",
      earned: false,
      Icon: Flame,
    },
    {
      id: "ach3",
      title: "First Sip",
      offer: "+50 Beans",
      constraint: "5 lifetime orders",
      earnedAt: "Earned Mar 4",
      earned: true,
      Icon: Award,
    },
    {
      id: "ach4",
      title: "Bean Counter",
      offer: "+100 Beans + RM5 voucher",
      constraint: "1,000 lifetime Beans",
      earnedAt: "Earned Feb 18",
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

const C = {
  bg:       "#F8F5F2",
  surface:  "#FFFFFF",
  surfaceWarm: "#FBEBE8",
  espresso: "#1A0200",
  border:   "#E5E5E5",
  primary:  "#C05040",
  gold:     "#FBBF24",
  ready:    "#22C55E",   // claimable / ready-to-use
  locked:   "#8E8E93",   // not yet
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
        <StatStrip points={m.member.points} streakWeeks={m.member.streakWeeks} />

        <Grid2>
          <BagCard {...m.beanBag} />
          <MissionCard
            state={missionState}
            title={m.mission.title}
            offer={m.mission.offer}
            progressCurrent={m.mission.progressCurrent}
            progressTarget={m.mission.progressTarget}
            onClaim={claimMission}
          />
        </Grid2>

        {(m.claimableMilestones.length > 0 || m.claimableAdmin.length > 0) && (
          <Grid2>
            {m.claimableMilestones.map((c) => (
              <RewardCardTpl
                key={c.id}
                Icon={c.Icon}
                eyebrow="MILESTONE"
                title={c.title}
                offer={c.offer}
                constraint={c.constraint}
                status="ready"
                action={{ label: "Claim", onPress: () => {} }}
              />
            ))}
            {m.claimableAdmin.map((c) => (
              <RewardCardTpl
                key={c.id}
                Icon={c.Icon}
                eyebrow="GIFT"
                title={c.title}
                offer={c.offer}
                constraint={c.constraint}
                status="ready"
                action={{ label: "Claim", onPress: () => {} }}
              />
            ))}
          </Grid2>
        )}

        <Grid2>
          {m.yourRewards.map((v) => (
            <RewardCardTpl
              key={v.id}
              Icon={v.Icon}
              eyebrow="WALLET"
              title={v.title}
              offer={v.offer}
              constraint={v.constraint}
              status="ready"
              action={{ label: "Use", onPress: () => {} }}
            />
          ))}
        </Grid2>

        <Grid2>
          {m.achievements.map((a) =>
            a.earned ? (
              <RewardCardTpl
                key={a.id}
                Icon={a.Icon}
                eyebrow="EARNED"
                title={a.title}
                offer={a.offer}
                constraint={a.earnedAt}
                status="earned"
              />
            ) : (
              <RewardCardTpl
                key={a.id}
                Icon={a.Icon}
                eyebrow="ACHIEVEMENT"
                title={a.title}
                offer={a.offer}
                constraint={a.constraint}
                status="locked"
                progress={{
                  current: a.progressCurrent ?? 0,
                  target: a.progressTarget ?? 1,
                  unit: a.progressUnit ?? "",
                }}
              />
            ),
          )}
        </Grid2>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
          {m.catalog.map((r) => (
            <CatalogTicket key={r.id} Icon={r.Icon} name={r.name} pts={r.pts} balance={m.member.points} />
          ))}
        </ScrollView>
      </ScrollView>

      <BottomNav />

      {missionCelebration && (
        <MissionClaimCelebration
          title={m.mission.title}
          offer={m.mission.offer}
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

function Grid2({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>{children}</View>;
}

// ─── Unified reward card template ───────────────────────────────────
//
// Every reward / achievement / claimable on the page renders through
// this single template so the visual language is identical:
//   - Status dot (top-right): ready / locked / earned
//   - Icon tile + eyebrow row
//   - Title (the offer name)
//   - Offer line (what you get when you redeem)
//   - Constraint line (expiry / threshold / cost)
//   - Footer: action pill (ready) OR progress bar (locked) OR
//             earned-on date (earned)

const CARD_W = "48%" as const;
const CARD_MIN_H = 168;

type CardStatus = "ready" | "locked" | "earned";

function RewardCardTpl({
  Icon, eyebrow, title, offer, constraint, status, action, progress,
}: {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  eyebrow: string;
  title: string;
  offer: string;
  constraint?: string;
  status: CardStatus;
  action?: { label: string; onPress: () => void };
  progress?: { current: number; target: number; unit: string };
}) {
  const dark = status !== "locked";
  const bg = dark ? C.espresso : C.surface;
  const border = dark ? C.espresso : C.border;
  const fg = dark ? "#FFFFFF" : C.espresso;
  const muted = dark ? "rgba(255,255,255,0.6)" : C.mutedFg;
  const accent = status === "ready" ? C.gold : status === "earned" ? C.gold : C.primary;
  const iconTileBg = dark ? "rgba(251,191,36,0.18)" : "rgba(192,80,64,0.10)";

  return (
    <View
      style={{
        width: CARD_W,
        minHeight: CARD_MIN_H,
        padding: 12,
        borderRadius: 16,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      {/* Status dot — top-right corner, always present. */}
      <View style={{ position: "absolute", top: 12, right: 12 }}>
        <StatusDot status={status} />
      </View>

      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: iconTileBg, alignItems: "center", justifyContent: "center" }}>
        <Icon size={18} color={accent} strokeWidth={2} />
      </View>

      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: accent, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 8 }}>
        {eyebrow}
      </Text>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: fg, marginTop: 2 }} numberOfLines={1}>
        {title}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11.5, color: muted, marginTop: 2 }} numberOfLines={2}>
        {offer}
      </Text>

      {/* Constraint row — small inline icon + text. Surfaces expiry,
          threshold, cost, source, etc. in a consistent slot so the
          customer's eye always lands in the same place for "the
          fine print." */}
      {constraint && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
          <Clock size={10} color={muted} strokeWidth={2} />
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10.5, color: muted }} numberOfLines={1}>
            {constraint}
          </Text>
        </View>
      )}

      {/* Footer */}
      <View style={{ marginTop: "auto", paddingTop: 10 }}>
        {status === "ready" && action && (
          <Pressable
            onPress={action.onPress}
            className="active:opacity-85"
            style={{ backgroundColor: C.gold, borderRadius: 100, paddingVertical: 7, alignItems: "center" }}
          >
            <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: C.espresso }}>
              {action.label}
            </Text>
          </Pressable>
        )}
        {status === "locked" && progress && (
          <>
            <View style={{ height: 5, borderRadius: 3, backgroundColor: "rgba(192,80,64,0.12)", overflow: "hidden" }}>
              <View
                style={{
                  height: "100%",
                  width: `${Math.round(Math.min(1, progress.current / Math.max(1, progress.target)) * 100)}%`,
                  backgroundColor: C.primary,
                  borderRadius: 3,
                }}
              />
            </View>
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.primary, letterSpacing: 0.8, marginTop: 6 }}>
              {progress.current}/{progress.target} {progress.unit}
            </Text>
          </>
        )}
        {status === "earned" && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Check size={12} color={C.gold} strokeWidth={2.6} />
            <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.gold, letterSpacing: 0.6 }}>
              UNLOCKED
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatusDot({ status }: { status: CardStatus }) {
  const map = {
    ready:  { bg: "rgba(34,197,94,0.18)",  fg: C.ready,  label: "READY"   },
    locked: { bg: "rgba(142,142,147,0.18)", fg: C.locked, label: "LOCKED" },
    earned: { bg: "rgba(251,191,36,0.18)", fg: C.gold,   label: "EARNED" },
  } as const;
  const s = map[status];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 100,
        backgroundColor: s.bg,
      }}
    >
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: s.fg }} />
      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 8.5, color: s.fg, letterSpacing: 0.8 }}>
        {s.label}
      </Text>
    </View>
  );
}

// ─── Bag + Mission cards (specialised variants) ────────────────────

function BagCard({
  available, weeksAtQualify, label, Icon, offer, constraint,
}: {
  available: boolean;
  weeksAtQualify: number;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  offer: string;
  constraint: string;
}) {
  if (!available) {
    return (
      <RewardCardTpl
        Icon={Flame}
        eyebrow="STREAK"
        title="Build your streak"
        offer="Order once a week to unlock a bag"
        constraint="No streak yet"
        status="locked"
        progress={{ current: 0, target: 1, unit: "wk" }}
      />
    );
  }
  return (
    <RewardCardTpl
      Icon={Icon}
      eyebrow={`WK ${weeksAtQualify} BAG`}
      title={label}
      offer={offer}
      constraint={constraint}
      status="ready"
      action={{ label: "Open bag", onPress: () => {} }}
    />
  );
}

function MissionCard({
  state, title, offer, progressCurrent, progressTarget, onClaim,
}: {
  state: "active" | "complete-unclaimed" | "no-active";
  title: string;
  offer: string;
  progressCurrent: number;
  progressTarget: number;
  onClaim?: () => void;
}) {
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
        <View style={{ position: "absolute", top: 12, right: 12 }}>
          <StatusDot status="locked" />
        </View>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(192,80,64,0.10)", alignItems: "center", justifyContent: "center" }}>
          <Target size={18} color={C.primary} strokeWidth={2} />
        </View>
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: C.primary, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 8 }}>
          CHALLENGE
        </Text>
        <Text style={{ fontFamily: "Peachi-Bold", fontSize: 14, color: C.espresso, marginTop: 2 }}>
          Pick this week
        </Text>
        <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11.5, color: C.mutedFg, marginTop: 2 }} numberOfLines={2}>
          Earn rewards by Sunday
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
          <Clock size={10} color={C.mutedFg} strokeWidth={2} />
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10.5, color: C.mutedFg }}>
            Resets Sunday
          </Text>
        </View>
        <View style={{ marginTop: "auto", paddingTop: 10 }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.primary, letterSpacing: 0.8 }}>
            TAP TO PICK →
          </Text>
        </View>
      </Pressable>
    );
  }

  if (state === "complete-unclaimed") {
    return (
      <RewardCardTpl
        Icon={Check}
        eyebrow="MISSION DONE"
        title={title}
        offer={offer}
        constraint={`Completed ${progressCurrent}/${progressTarget}`}
        status="ready"
        action={{ label: "Claim reward", onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onClaim?.();
        }}}
      />
    );
  }

  return (
    <RewardCardTpl
      Icon={Target}
      eyebrow="ACTIVE"
      title={title}
      offer={offer}
      constraint="Ends Sunday"
      status="locked"
      progress={{ current: progressCurrent, target: progressTarget, unit: "done" }}
    />
  );
}

// ─── Catalog ticket (horizontal rail) ──────────────────────────────

function CatalogTicket({
  Icon, name, pts, balance,
}: {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  name: string;
  pts: number;
  balance: number;
}) {
  const affordable = balance >= pts;
  const shortBy = pts - balance;
  return (
    <View
      style={{
        width: 140,
        padding: 12,
        borderRadius: 16,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <View style={{ position: "absolute", top: 10, right: 10 }}>
        <StatusDot status={affordable ? "ready" : "locked"} />
      </View>
      <View style={{ height: 60, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(192,80,64,0.10)", alignItems: "center", justifyContent: "center" }}>
          <Icon size={22} color={C.primary} strokeWidth={2} />
        </View>
      </View>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 13, color: C.espresso, marginTop: 4 }} numberOfLines={2}>
        {name}
      </Text>
      <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 10.5, color: C.mutedFg, marginTop: 2 }}>
        {affordable ? "Ready to redeem" : `${shortBy.toLocaleString()} more Beans`}
      </Text>
      <View
        style={{
          marginTop: 8,
          paddingVertical: 5,
          borderRadius: 100,
          backgroundColor: affordable ? C.espresso : "rgba(26,2,0,0.06)",
          alignItems: "center",
        }}
      >
        <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 11, color: affordable ? C.gold : C.faintFg, letterSpacing: 0.4 }}>
          {pts.toLocaleString()} BEANS
        </Text>
      </View>
    </View>
  );
}

// ─── Mission claim celebration ──────────────────────────────────────

function MissionClaimCelebration({
  title, offer, onClose,
}: {
  title: string;
  offer: string;
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

          <View style={{ alignSelf: "stretch", marginTop: 18, borderTopWidth: 1, borderTopColor: "rgba(251,191,36,0.15)", paddingTop: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Gift size={16} color={C.gold} strokeWidth={2} />
            <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 13, color: "rgba(255,255,255,0.92)" }} numberOfLines={1}>
              {offer}
            </Text>
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
