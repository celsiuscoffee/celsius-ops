// Ops Pulse configuration — run mode, thresholds, escalation, templates.
//
// Defaults are the owner-confirmed values from docs/design/ops-kpi-pulse-loop.md
// (phone floor 60%, escalation 90 min). Kept here so there is one place to tune.

export type PulseMode = "off" | "shadow" | "armed";

// OPS_PULSE_MODE controls the loop:
//   off    — cron is a no-op (kill switch).
//   shadow — DEFAULT. Detect + route + log only. No DB writes, no WhatsApp sends.
//   armed  — persist OpsAlert, DM the manager, escalate to the owner past SLA.
// Unset ⇒ shadow, so deploying starts the read-only shadow week automatically.
export function pulseMode(): PulseMode {
  const m = (process.env.OPS_PULSE_MODE || "shadow").trim().toLowerCase();
  return m === "off" || m === "armed" ? m : "shadow";
}

// Controls the DAILY pulse — a once-a-day digest per recipient, the habit-builder
// shipped first. Independent of OPS_PULSE_MODE so the daily digest can go live
// while the real-time path stays in shadow. off | shadow | armed.
//
// Defaults to "shadow" (log-only): deploying is always safe and never sends a
// WhatsApp on its own. Going live is a deliberate, reviewed step — confirm the
// [ops-pulse:daily:shadow] per-recipient output looks sane AND an approved
// OPS_PULSE_TPL_DAILY template is set, THEN flip OPS_PULSE_DAILY_MODE=armed.
// (Arming is safe to do anytime: the daily has no ledger, so it just re-evaluates
// the full current state each day — a missed/failed send is retried tomorrow.)
export function dailyMode(): PulseMode {
  const m = (process.env.OPS_PULSE_DAILY_MODE || "shadow").trim().toLowerCase();
  return m === "off" || m === "armed" ? m : "shadow";
}

// Signals that fire on the FAST real-time pulse (every ~5 min). Everything else
// surfaces only in the daily digest. Owner: Google reviews + menu-snoozed must be
// instant; incidents (checklist, receiving) are good candidates too. Override via
// OPS_PULSE_REALTIME_SIGNALS (comma-separated).
export const REALTIME_SIGNALS: Set<string> = new Set(
  (process.env.OPS_PULSE_REALTIME_SIGNALS || "REVIEW,MENU_SNOOZED,NO_CLOCK_IN,POS_NOT_OPEN,CHECKLIST,RECEIVING")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

export const THRESHOLDS = {
  phoneCapture: {
    // Breach if the day's completed-order phone-capture rate for an outlet is
    // below this. Target is higher (80%); this is the floor that pages someone.
    floorPct: 60,
    // Don't judge an outlet until it has at least this many completed orders
    // today — a 0/3 morning is noise, not a coaching signal.
    minOrders: 10,
  },
  checklist: {
    // Minutes past dueAt before a still-incomplete checklist counts as a breach.
    graceMinutes: 30,
    // Ceiling on how stale a miss can be and still page. Past this the checklist
    // is backlog, not today's miss — suppress it so arming doesn't burst on
    // historical/orphaned rows (mirrors review.recencyHours / receiving.recencyDays).
    // 24h keeps it to today's miss only — don't carry yesterday's into today (owner).
    staleAfterHours: 24,
  },
  review: {
    // QR feedback is already 1–3★ (4–5★ redirect to Google), so page only the
    // clearly-bad: rating ≤ this. (1★ = HIGH severity, 2★ = MED, 3★ = skip.)
    internalMaxRating: 2,
    // Negative Google reviews awaiting a reply decision are 1–3★ — all worth a nudge.
    googleMaxRating: 3,
    // Only page reviews newer than this, so first-arm doesn't burst on old backlog.
    recencyHours: 72,
  },
  stockCount: {
    // No SUBMITTED/REVIEWED stock count for an active outlet within this many
    // days → overdue (procurement).
    cadenceDays: 7,
  },
  receiving: {
    // Receivings with a discrepancy (DISPUTED/PARTIAL) in this window get paged.
    recencyDays: 7,
  },
  menuSnooze: {
    // Page an outlet once its snoozed (86'd / out-of-stock) item count reaches this.
    minItems: 1,
  },
  attendance: {
    // Minutes past a published shift's start_time before "no clock-in" counts.
    graceMinutes: 15,
  },
  posOpen: {
    // Minutes past an outlet's openTime before "POS not opened" counts. 0 = the
    // moment past open time — exactly on the open time, no grace (owner).
    graceMinutes: 0,
  },
  escalation: {
    // Minutes an alert may sit OPEN (unacked) before it escalates to the owner.
    slaMinutes: 90,
  },
} as const;

// ── Routing ──────────────────────────────────────────────────
// Discipline (routeKey) → recipient names, matched case-insensitively against
// User.name. Multiple recipients allowed; the FIRST is primary (owns the
// ledger row's ack/escalation), the rest are co-recipients who also get the
// digest. Unresolved names fall back to the owner (logged). Override via env.
function splitNames(v: string | undefined, def: string): string[] {
  return (v || def).split(",").map((s) => s.trim()).filter(Boolean);
}

// Each entry is a User name OR a raw phone number (+60…/01…). Confirmed against
// the production DB: barista lead = "Syafiq Kaberi" (+601137506488), kitchen =
// "Chef Bo" (+60126057787) — both active MANAGERs, so name routing resolves and
// their "DONE" replies attribute correctly.
export const RECIPIENTS: Record<string, string[]> = {
  operations: splitNames(process.env.OPS_PULSE_OPS_RECIPIENTS, "Ariff,Adam Kelvin"),
  barista: splitNames(process.env.OPS_PULSE_BARISTA_RECIPIENTS, "Syafiq Kaberi"),
  kitchen: splitNames(process.env.OPS_PULSE_KITCHEN_RECIPIENTS, "Chef Bo"),
};

// Routine vs adhoc taxonomy. Routine = scheduled expectations checked at their
// due time (clock-in, POS open, checklist, audits, stock, phone capture); adhoc =
// spontaneous events that fire on occurrence (reviews, 86'd items, receiving
// disputes). Owner: reviews are adhoc. Used to group the digest.
export type SignalCategory = "routine" | "adhoc";

export const SIGNAL_CATEGORY: Record<string, SignalCategory> = {
  NO_CLOCK_IN: "routine",
  POS_NOT_OPEN: "routine",
  CHECKLIST: "routine",
  AUDIT: "routine", // outlet audits + staff skill training
  STOCK_COUNT: "routine",
  RESTOCK_NEEDED: "routine",
  PHONE_CAPTURE: "routine",
  REVIEW: "adhoc",
  MENU_SNOOZED: "adhoc",
  RECEIVING: "adhoc",
};

export function categoryFor(signal: string): SignalCategory {
  return SIGNAL_CATEGORY[signal] ?? "routine";
}

// Restock-needed is held OFF until stock counts are reliable — par-level alerts
// are noise while StockBalance is stale (78% of items read below reorder today,
// because counts aren't being done). Fix stock counts first (the nudge to
// Ariff/Adam), then flip OPS_PULSE_RESTOCK_ENABLED=true.
export const RESTOCK_ENABLED = (process.env.OPS_PULSE_RESTOCK_ENABLED || "false").toLowerCase() === "true";

// No-clock-in alerts are held OFF until clock-in adoption is real. Today only
// ~4 of ~22 scheduled staff clock in (28 logs/7d), so flagging the rest is
// mostly an adoption gap, not no-shows — it would bury the digest in ~15-20
// false misses a day. Flip OPS_PULSE_NOCLOCKIN_ENABLED=true once clock-in is
// actually being used, the same gating used for restock alerts above.
export const NOCLOCKIN_ENABLED = (process.env.OPS_PULSE_NOCLOCKIN_ENABLED || "false").toLowerCase() === "true";

// Signals that ALSO nudge the on-shift outlet team (not just the discipline
// lead), because the team is accountable for what happened on their shift —
// stock take (they do the work), bad reviews (they served it), phone capture
// (they ask for the number) and checklists (they complete them). The on-shift
// roster includes that shift's lead. Comma-separated; override via
// OPS_PULSE_TEAM_NOTIFY_SIGNALS.
export const TEAM_NOTIFY_SIGNALS: Set<string> = new Set(
  (process.env.OPS_PULSE_TEAM_NOTIFY_SIGNALS || "STOCK_COUNT,REVIEW,PHONE_CAPTURE,CHECKLIST")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
);

// Map an auditor roleType to its routing discipline.
export function routeForRole(role: string): "barista" | "kitchen" | "operations" {
  if (role === "barista_head") return "barista";
  if (role === "chef_head") return "kitchen";
  return "operations";
}

// Human label for an auditor roleType — for staff-facing copy (never leak the
// internal "barista_head"/"chef_head" enum into a WhatsApp message).
export function auditRoleLabel(role: string): string {
  if (role === "barista_head") return "Barista station";
  if (role === "chef_head") return "Kitchen";
  return role;
}

// Audit / training coverage. The schema has NO audit cadence, so we define one:
// each tracked auditor role should have a COMPLETED report at each active outlet
// within `cadenceDays`. A role only pulses if it has an active AuditTemplate, so
// configuring a role that doesn't exist yet is a harmless no-op. Severity is LOW
// (a reminder/scorecard line — never escalated). Kept separate from THRESHOLDS
// so `roles` stays a mutable string[] for Prisma `in:` filters.
export const AUDIT = {
  // Owner-set frequency: 7 = weekly (chosen 2026-06-24), 30 monthly, 90 quarterly.
  cadenceDays: 7,
  // AuditTemplate.roleType values to watch (confirmed against live data):
  //   barista_head — barista lead (Barista Station Audit / Barista Skills)
  //   chef_head    — food director  (Kitchen Quality Audit / Kitchen Crew Skills)
  // Coverage counts a COMPLETED report of either the OUTLET or STAFF template for
  // that role. Override with OPS_PULSE_AUDIT_ROLES (comma-separated).
  roles: (process.env.OPS_PULSE_AUDIT_ROLES || "barista_head,chef_head")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

// Approved WhatsApp template names for proactive (out-of-24h-window) sends.
// Until a template is APPROVED in WhatsApp Manager and set here, the sender
// falls back to free-form text — which Meta only delivers inside the recipient's
// open 24h window (fine for testing, NOT for production paging). Set these
// before flipping OPS_PULSE_MODE=armed.
// Template names default to the standard ops_pulse_* set (created in WhatsApp
// Manager / via the templates create endpoint). Sending tries the template first
// and FALLS BACK to free-form when it isn't APPROVED yet (see sendProactive), so
// wiring the names here is safe even before approval — no env var needed once the
// templates go live. Override only to point at differently-named templates.
export const TEMPLATES = {
  managerDigest: process.env.OPS_PULSE_TPL_DIGEST || "ops_pulse_digest",
  ownerEscalation: process.env.OPS_PULSE_TPL_ESCALATION || "ops_pulse_escalation",
  dailyDigest: process.env.OPS_PULSE_TPL_DAILY || "ops_pulse_daily",
  audit: process.env.OPS_PULSE_TPL_AUDIT || "ops_pulse_audit",
  // Manager-authored reminder pinged to the assignee (on assign + when due).
  reminder: process.env.OPS_PULSE_TPL_REMINDER || "ops_reminder",
  // Ad-hoc directive/announcement fanned out to staff from the workspace.
  instruction: process.env.OPS_PULSE_TPL_INSTRUCTION || "ops_instruction",
  // Weekly performance scoreboard (cashier DM / leader digest).
  scoreboard: process.env.OPS_PULSE_TPL_SCOREBOARD || "ops_scoreboard",
  // Real-time staff nudge (clock-in / stock count).
  nudge: process.env.OPS_PULSE_TPL_NUDGE || "ops_nudge",
  languageCode: process.env.OPS_PULSE_TPL_LANG || "en",
} as const;
