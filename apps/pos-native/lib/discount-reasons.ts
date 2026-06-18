// Reason codes + caps for cashier-applied discounts ("comps").
//
// Why this exists: a free-text manual discount with no reason and no name on it
// is the POS's biggest shrinkage hole — staff can knock any amount off any bill
// and reporting can't tell a legit comp (free review drink, KOL meal, a spill
// we made good) from theft. So every manual discount now has to carry a REASON
// from this fixed list, and each reason carries a hard CAP. The arbitrary,
// uncapped path ("Other") still exists for genuine edge cases but is the only
// one a manager has to justify with a note.
//
// To tune the caps or add a reason, edit ONLY this list — the order-level and
// per-line discount sheets both read from here, so they stay in lockstep.

/** Manager-tier roles that may apply a discount WITHOUT a manager PIN. Mirrors
 *  the server's MANAGER_ROLES set (apps/backoffice .../auth/pin). Roles arrive
 *  UPPERCASE from /api/pos/auth/pin (UserRole enum), so compare case-insensitively
 *  — the old `role === "staff"` check silently never matched (real staff are
 *  "STAFF"), which is why the PIN gate had been a no-op. */
const MANAGER_ROLES = new Set(["OWNER", "ADMIN", "MANAGER"]);

/** True when this role may apply a discount directly (no manager override). */
export function isManagerRole(role: string | null | undefined): boolean {
  return MANAGER_ROLES.has((role ?? "").trim().toUpperCase());
}

export type DiscountReason = {
  id: string;
  label: string;
  /** Hard ceiling in SEN, applied to BOTH order-level and per-line discounts
   *  for this reason. null = uncapped (free amount) — "Other" only. */
  maxSen: number | null;
  /** Require a typed note (captures the KOL handle / the specific reason). */
  requiresNote?: boolean;
  /** One-line helper shown under the reason once it's picked. */
  hint?: string;
};

// Caps are deliberate defaults — change the numbers here, not in the UI.
export const DISCOUNT_REASONS: DiscountReason[] = [
  { id: "review",           label: "Free drink (review)", maxSen: 1500, hint: "Customer left a Google review — one drink" },
  { id: "kol",              label: "KOL / influencer",    maxSen: 5000, requiresNote: true, hint: "Enter the KOL's name or @handle" },
  { id: "service_recovery", label: "Service recovery",    maxSen: 3000, hint: "Wrong order, spill, or a long wait" },
  { id: "staff_meal",       label: "Staff meal",          maxSen: 2000, hint: "On-shift staff meal allowance" },
  { id: "other",            label: "Other",               maxSen: null, requiresNote: true, hint: "Any other reason — note required" },
];

export function reasonById(id: string | null | undefined): DiscountReason | null {
  return DISCOUNT_REASONS.find((r) => r.id === id) ?? null;
}

/** Clamp a discount (sen) to BOTH the line/bill ceiling and the reason's cap. */
export function clampToReason(sen: number, reason: DiscountReason | null, ceilingSen: number): number {
  const caps = [Math.round(sen), Math.round(ceilingSen)];
  if (reason?.maxSen != null) caps.push(reason.maxSen);
  return Math.max(0, Math.min(...caps));
}

/** The human string persisted to pos_orders/pos_order_items.discount_reason —
 *  reason label plus the cashier's note when there is one. Single text column,
 *  so it reads naturally in a comps report ("KOL / influencer · @ammar"). */
export function composeReasonText(reason: DiscountReason | null, note: string): string | null {
  if (!reason) return null;
  const n = note.trim();
  return n ? `${reason.label} · ${n}` : reason.label;
}
