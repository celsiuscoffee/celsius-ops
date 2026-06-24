// Ops KPI Pulse runner. Orchestrates detect → route → (shadow) log.
//
// Phase 1 is SHADOW-ONLY: it never messages anyone and never writes the ledger.
// It logs each breach it *would* page so the owner can read a week of output and
// confirm every breach is real before we arm escalation (Phase 1b). See
// docs/design/ops-kpi-pulse-loop.md → "The Assignment".

import { pulseMode } from "./config";
import { detectPhoneCapture, detectChecklist } from "./detectors";
import { resolveAssignee } from "./router";
import type { Breach, PulseRunResult, RoutedBreach } from "./types";

// Last-4 only — shadow output goes to plaintext logs / cron responses, so never
// emit a full number there.
function maskPhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/[^0-9]/g, "");
  return d.length <= 4 ? "****" : `••••${d.slice(-4)}`;
}

export async function runOpsPulse(now = new Date()): Promise<PulseRunResult> {
  const mode = pulseMode();
  if (mode === "off") {
    return { mode, ranAt: now.toISOString(), breachCount: 0, routed: [], sent: 0 };
  }

  // Detectors are isolated: one failing must not sink the whole run.
  const [phone, checklist] = await Promise.all([
    detectPhoneCapture(now).catch((err) => {
      console.error("[ops-pulse] phone-capture detector failed:", err);
      return [] as Breach[];
    }),
    detectChecklist(now).catch((err) => {
      console.error("[ops-pulse] checklist detector failed:", err);
      return [] as Breach[];
    }),
  ]);
  const breaches: Breach[] = [...phone, ...checklist];

  // Resolve the accountable assignee once per outlet.
  const assigneeByOutlet = new Map<string, Awaited<ReturnType<typeof resolveAssignee>>>();
  const routed: RoutedBreach[] = [];
  for (const b of breaches) {
    if (!assigneeByOutlet.has(b.outletId)) {
      assigneeByOutlet.set(b.outletId, await resolveAssignee(b.outletId));
    }
    const a = assigneeByOutlet.get(b.outletId) ?? null;
    routed.push({ ...b, assignee: a ? { ...a, phone: maskPhone(a.phone) } : null });
  }

  // Sending is Phase 1b. If someone flips OPS_PULSE_MODE=armed before then,
  // be loud and stay safe — degrade to shadow rather than silently do nothing.
  if (mode === "armed") {
    console.warn("[ops-pulse] mode=armed but the sender/ledger are not wired yet — running as shadow (no sends).");
  }

  for (const r of routed) {
    console.log(
      "[ops-pulse:shadow]",
      JSON.stringify({
        signal: r.signal,
        severity: r.severity,
        outlet: r.outletName,
        wouldNotify: r.assignee
          ? { name: r.assignee.name, phone: r.assignee.phone, fallbackToOwner: r.assignee.fallback }
          : null,
        summary: r.summary,
      }),
    );
  }

  return { mode: "shadow", ranAt: now.toISOString(), breachCount: breaches.length, routed, sent: 0 };
}
