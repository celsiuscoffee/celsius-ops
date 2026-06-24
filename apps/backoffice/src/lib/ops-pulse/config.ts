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
  escalation: {
    // Minutes an alert may sit OPEN (unacked) before it escalates to the owner.
    slaMinutes: 90,
  },
} as const;

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
