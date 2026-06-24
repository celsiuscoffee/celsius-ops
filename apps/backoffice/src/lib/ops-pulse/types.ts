// Shared shapes for the Ops KPI Pulse. See docs/design/ops-kpi-pulse-loop.md.
//
// Phase 1 covers two real-time signals — POS phone-capture rate and overdue
// checklists. The detectors emit `Breach`es; the runner routes each to the
// accountable manager and (once armed) sends a 1:1 WhatsApp DM. In shadow mode
// nothing is sent — we only log what we *would* page, to validate the detectors.

export type OpsSignal = "PHONE_CAPTURE" | "CHECKLIST";

export type Severity = "LOW" | "MED" | "HIGH";

export interface Breach {
  signal: OpsSignal;
  outletId: string; // Prisma Outlet.id
  outletName: string;
  severity: Severity;
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
  // true when no outlet-matched MANAGER was found and we fell back to the owner.
  fallback: boolean;
}

export interface RoutedBreach extends Breach {
  assignee: Assignee | null;
}

export interface PulseRunResult {
  mode: "off" | "shadow" | "armed";
  ranAt: string;
  breachCount: number;
  routed: RoutedBreach[];
  sent: number; // always 0 until the armed sender lands (Phase 1b)
}
