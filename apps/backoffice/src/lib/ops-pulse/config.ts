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

export const RECIPIENTS: Record<string, string[]> = {
  operations: splitNames(process.env.OPS_PULSE_OPS_RECIPIENTS, "Ariff,Adam Kelvin"),
  barista: splitNames(process.env.OPS_PULSE_BARISTA_RECIPIENTS, "Syafiq"),
  kitchen: splitNames(process.env.OPS_PULSE_KITCHEN_RECIPIENTS, "Chef Bo"),
};

// Map an auditor roleType to its routing discipline.
export function routeForRole(role: string): "barista" | "kitchen" | "operations" {
  if (role === "barista_head") return "barista";
  if (role === "chef_head") return "kitchen";
  return "operations";
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
export const TEMPLATES = {
  managerDigest: process.env.OPS_PULSE_TPL_DIGEST || "",
  ownerEscalation: process.env.OPS_PULSE_TPL_ESCALATION || "",
  languageCode: process.env.OPS_PULSE_TPL_LANG || "en",
} as const;
