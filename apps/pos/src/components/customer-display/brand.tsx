"use client";

/**
 * Brand-coherent rewards UI for the customer-display, mirroring the
 * pickup-native /rewards screen:
 *   • Compact BeansHero card (tier color + Beans balance)
 *   • Single-column scroll of horizontal rows:
 *       - ChallengeCard (for missions; n/a here yet, kept for parity)
 *       - ClaimableRow (terracotta gradient)
 *       - VoucherRow   (wallet voucher, tap → applies to cart)
 *       - CatalogRow   (Spend Beans → mint voucher)
 *   • Peachi-Bold titles + Space Grotesk eyebrows + uppercase pills
 */

import * as React from "react";
import type { VoucherCard, ClaimableCard, TierInfo, ShopCard, MissionCard, UsualItem } from "@/lib/loyalty-snapshot";

function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return `rgba(146, 64, 14, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Relative luminance per WCAG (0..1). Used to decide whether a tier's
 * configured color is readable on the espresso bg or needs a contrast
 * fallback. Black Card (#1A0200) and Platinum (#000000) both come
 * back near-zero and would otherwise paint invisible text on the
 * #160800 espresso surface.
 */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLin((n >> 16) & 0xff);
  const g = toLin((n >> 8) & 0xff);
  const b = toLin(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Tier color, but swapped for cream when it's too dark to read on
 *  the espresso background. Use for foreground text/elements that
 *  carry the tier identity. Keep the original hex for accent rails
 *  and borders where dark-on-dark still works visually. */
function readableTierColor(hex: string): string {
  return luminance(hex) < 0.08 ? "#F5F3F0" : hex;
}

// ─── Beans hero ────────────────────────────────────────────────
// Compact tier-themed card — Beans balance prominent on the right,
// tier name + multiplier left. Matches the BeansHero in pickup-native
// at a smaller scale for the narrow side panel.
export function BeansHero({
  tier,
  nextTier,
  progress,
  balance,
  memberName,
}: {
  tier: TierInfo;
  nextTier: TierInfo;
  progress: { metric: "spend" | "visits"; current: number; target: number } | null;
  balance: number;
  memberName: string | null;
}) {
  const rawColor = tier?.color || "#A2492C";
  // Tier accent (rail + border + bg tint) — keep the configured color
  // even when it's near-black, because the alpha tint on espresso bg
  // still reads as "subtle dark frame" instead of disappearing entirely.
  const accent = rawColor;
  // Tier foreground (name, eyebrow, multiplier, benefits) — bump to
  // cream when the configured color is too dark to read on espresso.
  // Without this, Black Card / Platinum members see invisible text.
  const fg = readableTierColor(rawColor);
  const name = tier?.name || "Member";
  const mul = tier?.multiplier ?? 1;
  const pct = progress
    ? Math.min(100, Math.round((progress.current / Math.max(progress.target, 1)) * 100))
    : 0;
  const remaining = progress ? Math.max(0, progress.target - progress.current) : 0;

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{
        backgroundColor: hexWithAlpha(accent, 0.10),
        borderColor: hexWithAlpha(accent, 0.22),
      }}
    >
      <div className="h-1" style={{ backgroundColor: accent }} />
      <div className="px-4 pt-3.5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.18em]"
              style={{ fontFamily: "Space Grotesk", color: hexWithAlpha(fg, 0.7) }}
            >
              {memberName ? `Hi, ${memberName.split(" ")[0]}` : "Welcome"}
            </p>
            <p
              className="mt-0.5 text-xl"
              style={{ fontFamily: "Peachi", fontWeight: 700, color: fg }}
            >
              {name}
              {mul > 1 && (
                <span
                  className="ml-2 text-[11px]"
                  style={{ fontFamily: "Space Grotesk", color: hexWithAlpha(fg, 0.65) }}
                >
                  {mul}× Beans
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <p
              className="text-2xl leading-none"
              style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
            >
              {balance.toLocaleString()}
            </p>
            <p
              className="mt-1 text-[9px] font-bold uppercase tracking-[0.16em]"
              style={{ fontFamily: "Space Grotesk", color: hexWithAlpha(fg, 0.55) }}
            >
              Beans
            </p>
          </div>
        </div>

        {nextTier && progress && (
          <div className="mt-3">
            <div
              className="h-1.5 overflow-hidden rounded-full"
              style={{ backgroundColor: hexWithAlpha(fg, 0.18) }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: fg }}
              />
            </div>
            <p
              className="mt-1.5 text-[10px]"
              style={{ fontFamily: "Space Grotesk", color: hexWithAlpha(fg, 0.6) }}
            >
              {progress.metric === "spend"
                ? `RM ${remaining.toFixed(0)} more to ${nextTier.name}`
                : `${remaining} more visit${remaining === 1 ? "" : "s"} to ${nextTier.name}`}
            </p>
          </div>
        )}

        {/* Tier perks — pulled from tiers.benefits jsonb. Capped at 3 so
            the hero stays compact on the narrow side panel; remaining
            perks are visible on the member's pickup-app /tier-benefits
            screen. Each is rendered as a small dot-prefixed line. */}
        {tier && tier.benefits.length > 0 && (
          <ul
            className="mt-3 space-y-1 border-t pt-2.5"
            style={{ borderColor: hexWithAlpha(fg, 0.15) }}
          >
            {tier.benefits.slice(0, 3).map((b, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-[10.5px] leading-snug"
                style={{ fontFamily: "Space Grotesk", color: hexWithAlpha(fg, 0.78) }}
              >
                <span
                  className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: fg }}
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Row shell ────────────────────────────────────────────────
// Shared horizontal-card chassis. Theme drives palette so the same
// shape covers wallet vouchers, claimables, and catalog items.
type RowTheme = {
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  fg: string;
  fgDim: string;
  accent: string; // pill bg
  pillFg: string;
};

const THEME_TERRACOTTA: RowTheme = {
  bg: "#FBEBE8",
  border: "rgba(162,73,44,0.22)",
  iconBg: "#A2492C",
  iconColor: "#FFFFFF",
  fg: "#1A0200",
  fgDim: "rgba(26,2,0,0.55)",
  accent: "#A2492C",
  pillFg: "#FFFFFF",
};

const THEME_GOLD: RowTheme = {
  bg: "rgba(251,191,36,0.10)",
  border: "rgba(251,191,36,0.30)",
  iconBg: "#1A0200",
  iconColor: "#FBBF24",
  fg: "#F5F3F0",
  fgDim: "rgba(245,243,240,0.55)",
  accent: "#FBBF24",
  pillFg: "#1A0200",
};

const THEME_NEUTRAL: RowTheme = {
  bg: "rgba(245,243,240,0.05)",
  border: "rgba(245,243,240,0.12)",
  iconBg: "rgba(245,243,240,0.10)",
  iconColor: "#F5F3F0",
  fg: "#F5F3F0",
  fgDim: "rgba(245,243,240,0.55)",
  accent: "#F5F3F0",
  pillFg: "#1A0200",
};

function IconSvg({ kind, color }: { kind: "gift" | "tag" | "cup"; color: string }) {
  if (kind === "gift") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 12 20 22 4 22 4 12" />
        <rect x="2" y="7" width="20" height="5" />
        <line x1="12" y1="22" x2="12" y2="7" />
        <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
        <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
      </svg>
    );
  }
  if (kind === "tag") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8h1a4 4 0 010 8h-1" />
      <path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
      <line x1="6" y1="2" x2="6" y2="5" />
      <line x1="10" y1="2" x2="10" y2="5" />
      <line x1="14" y1="2" x2="14" y2="5" />
    </svg>
  );
}

function RewardRow({
  theme,
  eyebrow,
  title,
  sub,
  pillLabel,
  iconKind,
  disabled,
  onClick,
}: {
  theme: RowTheme;
  eyebrow: string;
  title: string;
  sub: string;
  pillLabel: string;
  iconKind: "gift" | "tag" | "cup";
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ backgroundColor: theme.bg, border: `1px solid ${theme.border}` }}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
        style={{ backgroundColor: theme.iconBg }}
      >
        <IconSvg kind={iconKind} color={theme.iconColor} />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className="text-[9.5px] font-bold uppercase tracking-[0.16em]"
          style={{ fontFamily: "Space Grotesk", color: theme.accent }}
        >
          {eyebrow}
        </p>
        <p
          className="mt-0.5 truncate text-[15px]"
          style={{ fontFamily: "Peachi", fontWeight: 700, color: theme.fg, lineHeight: 1.2 }}
        >
          {title}
        </p>
        <p
          className="mt-0.5 truncate text-[11px]"
          style={{ fontFamily: "Space Grotesk", color: theme.fgDim }}
        >
          {sub}
        </p>
      </div>
      <span
        className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em]"
        style={{
          fontFamily: "Space Grotesk",
          backgroundColor: theme.accent,
          color: theme.pillFg,
        }}
      >
        {pillLabel} ›
      </span>
    </button>
  );
}

// ─── Voucher row ──────────────────────────────────────────────
// Source-driven eyebrow + native-style urgency subline. Mirrors
// apps/pickup-native voucherSourceLabel + voucherUrgencyLabel so the
// in-store rewards panel reads identically to the customer's pickup
// app. The icon picks from the voucher title/discount type.
function sourceEyebrow(source: VoucherCard["source_type"]): string {
  switch (source) {
    case "mystery":           return "Mystery Bag";
    case "mission":           return "Challenge";
    case "birthday":          return "Birthday Gift";
    case "referral":          return "Referral Gift";
    case "manual":            return "Promo";
    case "points_redemption": return "Bean Points";
    default:                  return "Reward";
  }
}

/** Pick an icon kind from the voucher fields. Title-driven first
 *  (admins write it for humans), discount_type fallback. */
function voucherIcon(v: VoucherCard): "gift" | "tag" | "cup" {
  const t = (v.title ?? "").toLowerCase();
  const dt = v.discount_type;
  if (dt === "free_item" || /free|drink|coffee/.test(t)) return "cup";
  if (dt === "flat" || dt === "fixed_amount" || dt === "percent" || dt === "percentage" || /off|%|rm\d/i.test(t)) return "tag";
  return "gift";
}

/** "Expires in N days" / "Expires Aug 12" / "No expiry" — matches
 *  apps/pickup-native voucherUrgencyLabel exactly. */
function voucherSubline(v: VoucherCard): string {
  if (!v.expires_at) return v.description ?? "No expiry";
  const ms = new Date(v.expires_at).getTime() - Date.now();
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 0) return "Expired";
  if (days <= 3) return `Expires in ${days} day${days === 1 ? "" : "s"}`;
  if (days <= 14) return `Expires in ${days} days`;
  return `Expires ${new Date(v.expires_at).toLocaleDateString("en-MY", { month: "short", day: "numeric" })}`;
}

export function VoucherRow({
  voucher,
  onApply,
}: {
  voucher: VoucherCard;
  onApply: () => void;
}) {
  return (
    <RewardRow
      theme={THEME_TERRACOTTA}
      eyebrow={sourceEyebrow(voucher.source_type)}
      title={voucher.title}
      sub={voucherSubline(voucher)}
      pillLabel="Use"
      iconKind={voucherIcon(voucher)}
      onClick={onApply}
    />
  );
}

// ─── Claimable row ────────────────────────────────────────────
export function ClaimableRow({
  claimable,
  onClaim,
}: {
  claimable: ClaimableCard;
  onClaim: () => void;
}) {
  return (
    <RewardRow
      theme={THEME_TERRACOTTA}
      // Mirror native: pending mystery → "Mystery Bag"; admin push → "Promo"
      eyebrow={claimable.source_type === "mystery_pending" ? "Mystery Bag" : "Promo"}
      title={claimable.title}
      sub={claimable.description ?? "Tap to claim"}
      pillLabel={claimable.cta_label}
      iconKind="gift"
      onClick={onClaim}
    />
  );
}

// ─── Catalog (Spend Beans) row ────────────────────────────────
function describeShop(s: ShopCard): { iconKind: "gift" | "tag" | "cup" } {
  const name = (s.name ?? "").toLowerCase();
  if (/free/.test(name) || /drink/.test(name)) return { iconKind: "cup" };
  if (/rm|%|off|discount/.test(name)) return { iconKind: "tag" };
  return { iconKind: "gift" };
}

export function CatalogRow({
  shop,
  onMint,
}: {
  shop: ShopCard;
  onMint: () => void;
}) {
  const { iconKind } = describeShop(shop);
  return (
    <RewardRow
      theme={shop.affordable ? THEME_GOLD : THEME_NEUTRAL}
      // Native uses "Bean Points" for the points-shop bucket.
      eyebrow="Bean Points"
      title={shop.name}
      sub={shop.description ?? `${shop.points_required.toLocaleString()} Beans`}
      pillLabel={`${shop.points_required.toLocaleString()}`}
      iconKind={iconKind}
      disabled={!shop.affordable}
      onClick={onMint}
    />
  );
}

// ─── Mystery box (post-order reveal) ──────────────────────────
// Tap-to-open card shown on the Thank You screen whenever the member
// has unrevealed mystery_drops. Closed state pulses to draw the eye;
// revealed state swaps to the outcome (emoji + label + description).
// Outcome is fed in from the claim API response.
export type MysteryOutcome = {
  outcome_type: "voucher" | "multiplier" | "flat_beans";
  multiplier_value?: number | null;
  flat_beans_value?: number | null;
  label?: string | null;
  reveal_emoji?: string | null;
  voucher_title?: string | null;
  voucher_description?: string | null;
};

function describeOutcome(o: MysteryOutcome): { headline: string; sub: string; emoji: string } {
  const emoji = o.reveal_emoji || "✨";
  if (o.outcome_type === "voucher") {
    return {
      headline: o.voucher_title || o.label || "Surprise voucher!",
      sub: o.voucher_description || "Added to your wallet",
      emoji,
    };
  }
  if (o.outcome_type === "multiplier" && o.multiplier_value) {
    return {
      headline: `${o.multiplier_value}× Beans`,
      sub: o.label || "Boost on your next order",
      emoji,
    };
  }
  if (o.outcome_type === "flat_beans" && o.flat_beans_value) {
    return {
      headline: `+${o.flat_beans_value} Beans`,
      sub: o.label || "Added to your balance",
      emoji,
    };
  }
  return { headline: o.label || "Reward unlocked!", sub: "Enjoy ✨", emoji };
}

export function MysteryBox({
  status,
  outcome,
  onOpen,
}: {
  status: "closed" | "revealing" | "revealed";
  outcome: MysteryOutcome | null;
  onOpen: () => void;
}) {
  if (status === "revealed" && outcome) {
    const { headline, sub, emoji } = describeOutcome(outcome);
    return (
      <div
        className="cd-fade-in rounded-3xl border p-6 text-center"
        style={{
          backgroundColor: "rgba(251,191,36,0.10)",
          borderColor: "rgba(251,191,36,0.40)",
        }}
      >
        <div className="text-6xl">{emoji}</div>
        <p
          className="mt-3 text-2xl"
          style={{ fontFamily: "Peachi", fontWeight: 700, color: "#FBBF24" }}
        >
          {headline}
        </p>
        <p
          className="mt-1 text-sm"
          style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.65)" }}
        >
          {sub}
        </p>
      </div>
    );
  }

  // closed / revealing state — same visual, button disables while revealing
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={status === "revealing"}
      className="group relative w-full rounded-3xl border p-6 text-center transition active:scale-[0.98] disabled:cursor-wait"
      style={{
        backgroundColor: "rgba(162,73,44,0.14)",
        borderColor: "rgba(162,73,44,0.45)",
      }}
    >
      {/* Pulsing aura — recycles the nfc-pulse keyframe in globals.css
          for the lift / draw-eye effect with no new CSS. */}
      <span
        className="nfc-pulse absolute inset-0 rounded-3xl"
        style={{ backgroundColor: "rgba(162,73,44,0.25)", opacity: 0.5 }}
      />
      <div className="relative">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl text-4xl"
          style={{ backgroundColor: "#A2492C", color: "#FBEBE8" }}
        >
          {/* Gift box svg, more elegant than emoji */}
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 12 20 22 4 22 4 12" />
            <rect x="2" y="7" width="20" height="5" />
            <line x1="12" y1="22" x2="12" y2="7" />
            <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
            <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
          </svg>
        </div>
        <p
          className="mt-3 text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ fontFamily: "Space Grotesk", color: "rgba(251,191,36,0.85)" }}
        >
          Mystery Bean
        </p>
        <p
          className="mt-1 text-xl"
          style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0" }}
        >
          {status === "revealing" ? "Opening…" : "Tap to reveal"}
        </p>
      </div>
    </button>
  );
}

// ─── Tiny section label (optional) ────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-4 mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.18em]"
      style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.45)" }}
    >
      {children}
    </p>
  );
}

// ─── Mission / Challenge row ──────────────────────────────────
// Read-only progress card. Member ticks forward by placing orders that
// match the goal — cashier doesn't tap to complete. Mirrors the
// pickup-native ChallengeCard but slimmer.
export function ChallengeRow({ mission }: { mission: MissionCard }) {
  const pct = Math.min(100, Math.round((mission.progress_current / Math.max(mission.progress_target, 1)) * 100));
  const done = mission.status === "completed" || mission.progress_current >= mission.progress_target;
  const accent = done ? "#86efac" : "#FBBF24";
  return (
    <div
      className="rounded-2xl border p-3"
      style={{
        backgroundColor: done ? "rgba(34,197,94,0.08)" : "rgba(251,191,36,0.06)",
        borderColor: done ? "rgba(34,197,94,0.28)" : "rgba(251,191,36,0.22)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: done ? "rgba(34,197,94,0.18)" : "rgba(251,191,36,0.14)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {done ? <polyline points="20 6 9 17 4 12" /> : (
              <>
                <circle cx="12" cy="8" r="6" />
                <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
              </>
            )}
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="text-[9.5px] font-bold uppercase tracking-[0.16em]"
            style={{ fontFamily: "Space Grotesk", color: accent }}
          >
            {done ? "Completed" : "Challenge"}
            {mission.reward_bonus_beans > 0 && (
              <span style={{ color: "rgba(245,243,240,0.5)" }}> · +{mission.reward_bonus_beans} Beans</span>
            )}
          </p>
          <p
            className="mt-0.5 truncate text-[14px]"
            style={{ fontFamily: "Peachi", fontWeight: 700, color: "#F5F3F0", lineHeight: 1.25 }}
          >
            {mission.title}
          </p>
          {mission.description && (
            <p
              className="mt-0.5 truncate text-[11px]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
            >
              {mission.description}
            </p>
          )}
        </div>
      </div>
      {!done && (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: "rgba(251,191,36,0.15)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: accent }} />
          </div>
          <p
            className="mt-1 text-[10px]"
            style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.5)" }}
          >
            {formatMissionProgress(mission)}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Render mission progress in the right units. Spend goals store sen
 * (10000 = RM 100) and would otherwise display as "0 / 10000" — we
 * convert to "RM 0 / RM 100" so the customer reads it correctly.
 * Count goals render as plain integers.
 */
function formatMissionProgress(m: MissionCard): string {
  if (m.unit === "sen") {
    const current = Math.floor(m.progress_current / 100);
    const target = Math.floor(m.progress_target / 100);
    return `RM ${current} / RM ${target}`;
  }
  return `${m.progress_current} / ${m.progress_target}`;
}

// ─── "Your usual" reorder strip ───────────────────────────────
// Horizontal scroll of the member's top-ordered products. Passive
// display — cashier owns the add-to-cart action, customer just
// sees their regulars surfaced so the cashier knows what to suggest
// ("the usual today?"). The onAdd prop is kept on the signature to
// match older callers but is no longer wired to any tap target.
export function UsualStrip({
  items,
}: {
  items: UsualItem[];
  // Accepted for backwards compat but intentionally unused — the
  // strip is no longer tappable. Cashier handles add-to-cart.
  onAdd?: (item: UsualItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <SectionLabel>Your usual</SectionLabel>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {items.map((it) => (
          <div
            key={it.id}
            className="relative shrink-0 rounded-xl border p-2 w-[110px]"
            style={{
              borderColor: "rgba(245,243,240,0.10)",
              backgroundColor: "rgba(255,255,255,0.05)",
            }}
          >
            <div className="relative">
              <div
                className="aspect-square w-full rounded-lg bg-cover bg-center"
                style={{
                  backgroundImage: it.image_url ? `url(${it.image_url})` : undefined,
                  backgroundColor: "rgba(245,243,240,0.06)",
                }}
              />
              {/* Frequency badge — corner pill that doubles as
                  identity ("this is yours") and a usefulness signal
                  to the cashier ("they've had this 24× — push it"). */}
              <span
                className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{
                  fontFamily: "Space Grotesk",
                  backgroundColor: "rgba(26,2,0,0.78)",
                  color: "#FBBF24",
                }}
              >
                ×{it.times_ordered}
              </span>
            </div>
            <p
              className="mt-1.5 truncate text-[11px]"
              style={{ fontFamily: "Peachi", fontWeight: 500, color: "#F5F3F0" }}
            >
              {it.name}
            </p>
            <p
              className="text-[10px]"
              style={{ fontFamily: "Space Grotesk", color: "rgba(245,243,240,0.55)" }}
            >
              RM {(it.price_sen / 100).toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
