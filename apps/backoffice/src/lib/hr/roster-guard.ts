// Guard for edits to PUBLISHED rosters.
//
// The roster is the pay basis: the weekly calculator prices PT hours against
// the rostered window and the monthly calculator derives rest days from it, so
// editing a published week for a date already worked silently rewrites pay
// after the fact. That is exactly how most of a day's pay vanished on
// 2026-08-03 — and until this guard, the cell/assign routes checked neither
// schedule status nor date.
//
// Policy:
//   draft weeks           → free to edit (nothing announced, nothing paid).
//   published, future     → allowed (schedules legitimately change ahead of
//                           time; publish/notify flows handle announcement).
//   published, today      → allowed (same-day coverage moves are ops reality;
//                           the day's pay isn't settled until the log closes).
//   published, past date  → BLOCKED, unless an OWNER/ADMIN passes an explicit
//                           retro_reason. The override is activity-logged by
//                           the caller. Managers cannot retro-edit at all.

import { getMYTToday } from "./constants";

export type RosterEditClass = "draft" | "published_future" | "published_today" | "published_past";

export function classifyRosterEdit(
  scheduleStatus: string | null | undefined,
  shiftDate: string,
  todayMyt: string = getMYTToday(),
): RosterEditClass {
  if (scheduleStatus !== "published") return "draft";
  if (shiftDate > todayMyt) return "published_future";
  if (shiftDate === todayMyt) return "published_today";
  return "published_past";
}

export function retroEditRefusal(
  role: string,
  retroReason: string | null | undefined,
): { allowed: true } | { allowed: false; status: number; error: string } {
  if (!["OWNER", "ADMIN"].includes(role)) {
    return {
      allowed: false,
      status: 403,
      error:
        "This week is published and that date has already passed — the roster is the pay basis, so retroactive edits are locked. Ask an owner/admin if a correction is genuinely needed.",
    };
  }
  if (!retroReason || !retroReason.trim()) {
    return {
      allowed: false,
      status: 409,
      error:
        "This week is published and that date has already passed. Retroactive roster edits rewrite pay for hours already worked — pass retro_reason with a short justification to proceed (it will be audit-logged).",
    };
  }
  return { allowed: true };
}
