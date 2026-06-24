// Shared shapes for the Ops KPI Pulse. See docs/design/ops-kpi-pulse-loop.md.
//
// Signals are routed by DISCIPLINE (routeKey), not outlet→manager: operations
// (phone, checklist, reviews, procurement) → ops leads; barista/kitchen audit +
// skill → the discipline lead. Detectors stamp routeKey; the router resolves it
// to recipients.

export type OpsSignal =
  | "PHONE_CAPTURE"
  | "CHECKLIST"
  | "REVIEW"
  | "AUDIT"
  | "STOCK_COUNT"
  | "RECEIVING"
  | "MENU_SNOOZED"
  | "NO_CLOCK_IN"
  | "POS_NOT_OPEN";

export type Severity = "LOW" | "MED" | "HIGH";

export type OpsAlertStatus = "OPEN" | "ACKED" | "ESCALATED" | "RESOLVED" | "EXPIRED";

// Discipline a breach routes to. operations = ops/procurement leads; barista /
// kitchen = the skill-discipline lead.
export type RouteKey = "operations" | "barista" | "kitchen";

export interface Breach {
  signal: OpsSignal;
  outletId: string; // Prisma Outlet.id
  outletName: string;
  severity: Severity;
  routeKey: RouteKey;
  // Stable per (signal, outlet, period) so the ledger can dedupe once armed.
  dedupeKey: string;
  summary: string; // one-line, human-readable
  detail: Record<string, unknown>;
}

export interface Assignee {
  userId: string;
  name: string;
  phone: string | null; // masked before it ever leaves the process in shadow
  role: string;
  // true when this is an owner fallback (no configured recipient resolved).
  fallback: boolean;
}

export interface RoutedBreach extends Breach {
  // All recipients for this breach. First = primary (owns ack/escalation in the
  // ledger); the rest are co-recipients who also get the digest.
  assignees: Assignee[];
}

export interface PulseRunResult {
  mode: "off" | "shadow" | "armed";
  ranAt: string;
  breachCount: number;
  routed: RoutedBreach[];
  sent: number; // manager digests sent this run (0 in shadow)
  escalated: number; // alerts escalated to the owner this run (0 in shadow)
}
