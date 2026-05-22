/**
 * MOCK v5 — Unified rewards stream with opacity-based status.
 *
 * Three reward SOURCES, all on one page:
 *   1. CHALLENGE   — one-off missions that drive AOV + orders.
 *                    Spend RM100/bill, Refer-a-friend, Group Order,
 *                    Try New Things.
 *   2. MYSTERY BAG — point-of-sale reveal (the scratch card on the
 *                    order confirmation screen).
 *   3. POINTS      — Beans-to-redeem catalog (formerly "Spend Beans").
 *
 * Plus the existing wallet, achievements, and streak chests render
 * into the same stream.
 *
 * Every card surfaces the same four pieces of information:
 *   1. OFFER       — title + offer line ("Free Pastry + 30 Beans")
 *   2. HOW TO GET  — action pill ("Claim", "Use", "Open bag") or
 *                    progress bar
 *   3. CONSTRAINT  — small Clock row ("Expires Apr 12", "RM100 bill",
 *                    "1,200 Beans", "50 lifetime orders")
 *   4. STATUS      — pill in the top-right (READY / LOCKED / EARNED)
 *
 * Visual rule for ready-vs-locked:
 *   - Single espresso card surface for ALL rewards.
 *   - Ready (claimable now): full opacity, gold accent, gold action
 *     pill.
 *   - Locked: 55% opacity on the entire card. The customer reads it
 *     as "this exists but it's not for you yet" at a glance.
 *   - Earned (trophy): full opacity, gold "UNLOCKED" badge.
 */

import { useState } from "react";
import { View, Text, ScrollView, Pressable, Modal } from "react-native";
import { Stack, router } from "expo-router";
import {
  ChevronRight, Sparkles, Flame, Trophy, Gift,
  Target, Check, Package, Award, Coffee, Cookie,
  Tag, Sandwich, Star, Clock, Users, DollarSign, Search,
} from "lucide-react-native";
import * as Haptics from "@/lib/haptics";
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
  // Three reward TYPES on the page, in order:
  //   1. CHALLENGE  — 3 active per cycle (mix of ready / locked)
  //   2. POINTS     — Beans redemption (mix of ready / locked)
  //   3. MYSTERY    — past mystery-bag wins (earned trophies)
  //
  // Wallet / achievements / streak chest moved off this page —
  // wallet vouchers surface inline at checkout, achievements and
  // the streak chest live on their own surfaces.
  cards: [
    // ── 1. CHALLENGE (3 active, mix of states) ──────────────────────
    {
      kind: "challenge",
      id: "ch1",
      Icon: Check,
      eyebrow: "CHALLENGE",
      title: "Group Order",
      offer: "Free Pastry + 30 Beans",
      constraint: "Completed 3/3",
      status: "ready",
      action: "Claim",
    },
    {
      kind: "challenge",
      id: "ch2",
      Icon: DollarSign,
      eyebrow: "CHALLENGE",
      title: "Big Bill",
      offer: "Free Drink + 50 Beans",
      constraint: "RM100+ in one bill",
      status: "locked",
      progressCurrent: 62,
      progressTarget: 100,
      progressUnit: "RM",
    },
    {
      kind: "challenge",
      id: "ch3",
      Icon: Search,
      eyebrow: "CHALLENGE",
      title: "Try New Things",
      offer: "2× Beans Boost",
      constraint: "3 distinct new drinks",
      status: "locked",
      progressCurrent: 1,
      progressTarget: 3,
      progressUnit: "tried",
    },

    // ── 2. POINTS (Beans redemption) ────────────────────────────────
    {
      kind: "points",
      id: "p1",
      Icon: Gift,
      eyebrow: "POINTS",
      title: "Free Add-on",
      offer: "Any free add-on",
      constraint: "200 Beans",
      status: "ready",
      action: "Claim",
    },
    {
      kind: "points",
      id: "p2",
      Icon: Tag,
      eyebrow: "POINTS",
      title: "RM5 Off",
      offer: "RM5 off your order",
      constraint: "500 Beans",
      status: "ready",
      action: "Claim",
    },
    {
      kind: "points",
      id: "p3",
      Icon: Cookie,
      eyebrow: "POINTS",
      title: "Free Pastry",
      offer: "Any pastry under RM10",
      constraint: "800 Beans",
      status: "ready",
      action: "Claim",
    },

    {
      kind: "points",
      id: "p-locked-drink",
      Icon: Coffee,
      eyebrow: "POINTS",
      title: "Free Drink",
      offer: "Any drink at checkout",
      constraint: "1,200 Beans · 86 to go",
      status: "locked",
      progressCurrent: 1114,
      progressTarget: 1200,
      progressUnit: "Beans",
    },
    {
      kind: "points",
      id: "p-locked-lunch",
      Icon: Sandwich,
      eyebrow: "POINTS",
      title: "Free Lunch",
      offer: "Any lunch combo",
      constraint: "3,000 Beans · 686 to go",
      status: "locked",
      progressCurrent: 2314,
      progressTarget: 3000,
      progressUnit: "Beans",
    },

    // ── 3. MYSTERY BAG (point-of-sale wins) ─────────────────────────
    {
      kind: "mystery",
      id: "myst1",
      Icon: Sparkles,
      eyebrow: "MYSTERY BAG",
      title: "2× Beans",
      offer: "Doubled this order's Beans",
      constraint: "From order #1042",
      status: "earned",
    },
    {
      kind: "mystery",
      id: "myst2",
      Icon: Cookie,
      eyebrow: "MYSTERY BAG",
      title: "Free Pastry",
      offer: "Free pastry on next order",
      constraint: "From order #1038",
      status: "earned",
    },
  ] as MockCard[],
};

type MockCard = {
  kind: "challenge" | "mystery" | "points" | "wallet" | "achievement";
  id: string;
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  eyebrow: string;
  title: string;
  offer: string;
  constraint?: string;
  status: "ready" | "locked" | "earned";
  action?: string;
  progressCurrent?: number;
  progressTarget?: number;
  progressUnit?: string;
};

const C = {
  bg:       "#F8F5F2",
  surface:  "#FFFFFF",
  espresso: "#1A0200",
  border:   "#E5E5E5",
  primary:  "#A2492C",
  gold:     "#FBBF24",
  ready:    "#22C55E",
  locked:   "#8E8E93",
  mutedFg:  "#6B6B6B",
  faintFg:  "#8E8E93",
};

// ─── Screen ─────────────────────────────────────────────────────────

export default function RewardsMock() {
  const m = MOCK;

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
        <StatStrip points={m.member.points} />

        {/* Framing line — the page's purpose stated plainly. Every
            card below is either usable at checkout right now, one
            tap from being usable, or progress toward one. */}
        <View style={{ paddingHorizontal: 2, marginBottom: -8 }}>
          <Text
            style={{
              fontFamily: "Peachi-Bold",
              fontSize: 16,
              color: C.espresso,
              letterSpacing: -0.2,
            }}
          >
            Your checkout rewards
          </Text>
          <Text
            style={{
              fontFamily: "SpaceGrotesk_500Medium",
              fontSize: 12,
              color: C.mutedFg,
              marginTop: 2,
            }}
          >
            Earn from Challenges, Mystery Bag, or Points — use at checkout.
          </Text>
        </View>

        <Stack>
          {m.cards.map((c) => (
            <RewardCard key={c.id} {...c} />
          ))}
        </Stack>
      </ScrollView>

      <BottomNav />
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
// Beans only — streak lives on its own surface, no longer on this
// page.

function StatStrip({ points }: { points: number }) {
  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: C.border,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: C.faintFg, letterSpacing: 1.4, textTransform: "uppercase" }}>
        Beans
      </Text>
      <Text style={{ fontFamily: "Peachi-Bold", fontSize: 26, color: C.espresso, letterSpacing: -0.5, lineHeight: 30, marginTop: 2 }}>
        {points.toLocaleString()}
      </Text>
    </View>
  );
}

function CardStack({ children }: { children: React.ReactNode }) {
  return <View style={{ gap: 10 }}>{children}</View>;
}

// ─── Unified reward card (horizontal) ───────────────────────────────
//
// Full-width landscape card matching the rest of the app's reward
// surfaces (wallet voucher rows, claim cards). Anatomy:
//
//   ┌───────────────────────────────────────────────┐
//   │ [icon ]  EYEBROW                       • DOT  │
//   │ [tile ]  Title                                │
//   │          Offer line                           │
//   │          🕐 constraint              [Action]  │
//   │                                               │
//   │ ━━━━━━━━━━━━━━━━━━━━ (progress if locked)    │
//   └───────────────────────────────────────────────┘
//
// Status drives:
//   ready   → full opacity, action pill bottom-right
//   locked  → 55% opacity, progress bar across full width
//   earned  → full opacity, "UNLOCKED" check bottom-right

function RewardCard(props: MockCard) {
  const { Icon, eyebrow, title, offer, constraint, status, action, progressCurrent, progressTarget, progressUnit } = props;
  const isLocked = status === "locked";

  return (
    <View
      style={{
        padding: 14,
        borderRadius: 16,
        backgroundColor: C.espresso,
        borderWidth: 1,
        borderColor: C.espresso,
        opacity: isLocked ? 0.55 : 1,
      }}
    >
      {/* Top row — icon left, content middle, status dot right */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
        {/* Icon tile */}
        <View
          style={{
            width: 48, height: 48, borderRadius: 12,
            backgroundColor: "rgba(251,191,36,0.18)",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <Icon size={22} color={C.gold} strokeWidth={2} />
        </View>

        {/* Content column */}
        <View style={{ flex: 1, paddingRight: 64 }}>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 9.5, color: C.gold, letterSpacing: 1.4, textTransform: "uppercase" }}>
            {eyebrow}
          </Text>
          <Text style={{ fontFamily: "Peachi-Bold", fontSize: 16, color: "#FFFFFF", marginTop: 2 }} numberOfLines={1}>
            {title}
          </Text>
          <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 12.5, color: "rgba(255,255,255,0.65)", marginTop: 2 }} numberOfLines={2}>
            {offer}
          </Text>
          {constraint && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
              <Clock size={11} color="rgba(255,255,255,0.55)" strokeWidth={2} />
              <Text style={{ fontFamily: "SpaceGrotesk_500Medium", fontSize: 11.5, color: "rgba(255,255,255,0.55)" }} numberOfLines={1}>
                {constraint}
              </Text>
            </View>
          )}
        </View>

        {/* Top-right corner — status dot + (for ready) action pill stacked. */}
        <View style={{ position: "absolute", top: 0, right: 0, alignItems: "flex-end", gap: 8 }}>
          <StatusDot status={status} />
          {status === "ready" && action && (
            <Pressable
              className="active:opacity-85"
              style={{
                backgroundColor: C.gold,
                borderRadius: 100,
                paddingHorizontal: 14,
                paddingVertical: 7,
              }}
            >
              <Text style={{ fontFamily: "Peachi-Bold", fontSize: 12, color: C.espresso }}>
                {action}
              </Text>
            </Pressable>
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

      {/* Progress bar (locked only) — spans the full card width
          beneath the content so the customer's eye lands on "how
          close" at a glance. */}
      {status === "locked" && progressTarget !== undefined && (
        <View style={{ marginTop: 12 }}>
          <View style={{ height: 5, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
            <View
              style={{
                height: "100%",
                width: `${Math.round(Math.min(1, (progressCurrent ?? 0) / progressTarget) * 100)}%`,
                backgroundColor: C.gold,
                borderRadius: 3,
              }}
            />
          </View>
          <Text style={{ fontFamily: "SpaceGrotesk_700Bold", fontSize: 10.5, color: C.gold, letterSpacing: 0.8, marginTop: 6 }}>
            {(progressCurrent ?? 0).toLocaleString()}/{progressTarget.toLocaleString()}{progressUnit ? ` ${progressUnit}` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Status dot ─────────────────────────────────────────────────────

function StatusDot({ status }: { status: "ready" | "locked" | "earned" }) {
  const map = {
    ready:  { bg: "rgba(34,197,94,0.18)",   fg: C.ready,  label: "READY"   },
    locked: { bg: "rgba(142,142,147,0.18)", fg: C.locked, label: "LOCKED"  },
    earned: { bg: "rgba(251,191,36,0.18)",  fg: C.gold,   label: "EARNED"  },
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

// ─── Bean Bag card (streak chest) ──────────────────────────────────

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
      <RewardCard
        kind="challenge"
        id="bag"
        Icon={Flame}
        eyebrow="STREAK"
        title="Build your streak"
        offer="Order once a week to unlock a bag"
        constraint="No streak yet"
        status="locked"
        progressCurrent={0}
        progressTarget={1}
        progressUnit="wk"
      />
    );
  }
  return (
    <RewardCard
      kind="challenge"
      id="bag"
      Icon={Icon}
      eyebrow={`WK ${weeksAtQualify} BAG`}
      title={label}
      offer={offer}
      constraint={constraint}
      status="ready"
      action="Open"
    />
  );
}
