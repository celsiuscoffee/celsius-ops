// Ops Pulse configuration — thresholds + run mode.
//
// Defaults are the owner-proposed values from docs/design/ops-kpi-pulse-loop.md
// (tune during the shadow week). Kept here so there is one place to change them.

export type PulseMode = "off" | "shadow" | "armed";

// OPS_PULSE_MODE controls the loop:
//   off    — cron is a no-op (kill switch).
//   shadow — DEFAULT. Detect + route + log only. No DB writes, no WhatsApp sends.
//   armed  — (Phase 1b, not yet wired) would persist OpsAlert + DM the manager.
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
} as const;
