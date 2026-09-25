/**
 * Card terminal front-door for the checkout flow.
 *
 * One vendor: GHL / NTT Data ADAPTIS (lib/ghl-terminal.ts), which is what sits
 * on the counters. When a till has no terminal configured, the rehearsal stub
 * answers instead and flags itself `simulated` so the UI labels it and nobody
 * mistakes it for a real charge.
 *
 * (A Maybank X990 ECR client lived here too. It was never usable — blocked on
 * a line-encryption spec the vendor never supplied — and keeping a second,
 * untested payment path around is a liability, not an option. Removed when the
 * decision to standardise on NTT Data was made. Note this is unrelated to
 * lib/maybank-qr.ts, which drives the static QR on the customer display and is
 * still in use.)
 */
import { loadGhlConfig, ghlConfigured, chargeOnTerminal, settleOnTerminal, type GhlOutcome } from "./ghl-terminal";

export type TerminalResult =
  | {
      status: "approved";
      approvalCode: string;
      cardBrand: string;
      maskedPan: string;
      txnRef: string;
      /** true = no money moved: either the rehearsal stub, or the terminal
       *  config is in test mode pointing at the simulator. UI must label it. */
      simulated?: boolean;
      /** e.g. CONTACTLESS, CONTACT, Scan — how the guest paid. */
      entry?: string;
    }
  | { status: "declined"; reason: string }
  | { status: "cancelled" }
  | { status: "error"; code: string; message: string };

/** GHL verdicts map onto the result the register renders. "unknown" becomes an
 *  `error`, NOT a decline: the register shows errors as the amber "Check the
 *  terminal" screen, which is right for an outcome we cannot establish — it
 *  never tells a cashier the guest was not charged. */
function fromGhl(o: GhlOutcome & { ecrRef: string }): TerminalResult {
  switch (o.status) {
    case "approved":
      return {
        status: "approved",
        approvalCode: o.approvalCode,
        cardBrand: o.issuer ?? "CARD",
        maskedPan: o.maskedPan ?? (o.entry === "DUITNOWQR" ? "DuitNow QR" : ""),
        txnRef: o.rrn || o.ecrRef,
        entry: o.entry ?? undefined,
        // A simulator reply is a real reply; only this flag separates it from
        // money actually moving, so it must reach the cashier's screen.
        simulated: o.simulated,
      };
    case "declined":
      return { status: "declined", reason: o.reason };
    case "unknown":
      return { status: "error", code: "GHL_UNKNOWN", message: o.reason };
  }
}

/** Charge the guest's card on the terminal. `onStatus` streams the terminal's
 *  live state into the checkout UI. */
export async function chargeCard(
  amountSen: number,
  onStatus?: (s: string) => void,
  orderNo?: string,
): Promise<TerminalResult> {
  const ghl = await loadGhlConfig();
  if (ghlConfigured(ghl)) {
    return fromGhl(await chargeOnTerminal({ amountSen, orderNo, onStatus }));
  }
  // ── Rehearsal stub: no terminal configured on this till ──
  await new Promise((r) => setTimeout(r, 2500));
  return {
    status: "approved",
    simulated: true,
    approvalCode: `SIM-${Math.floor(Math.random() * 900000 + 100000)}`,
    cardBrand: "VISA",
    maskedPan: "**** **** **** 4242",
    txnRef: `SIM-${Date.now().toString().slice(-10)}`,
  };
}

/** DuitNow QR on the terminal's own screen (distinct from the static QR on the
 *  customer display — see lib/maybank-qr.ts). */
export async function chargeDuitNowQr(
  amountSen: number,
  onStatus?: (s: string) => void,
): Promise<TerminalResult> {
  const ghl = await loadGhlConfig();
  if (!ghlConfigured(ghl)) {
    return { status: "error", code: "NO_TERMINAL", message: "Terminal not configured (Settings → GHL Terminal)" };
  }
  return fromGhl(await chargeOnTerminal({ amountSen, duitnowQr: true, onStatus }));
}

/** End-of-day settlement — called from store close. Best-effort: settlement can
 *  also be run from the terminal's own menu, so a failure here must never block
 *  the Z-report close. */
export async function settleTerminal(): Promise<{ ok: boolean; message: string }> {
  const ghl = await loadGhlConfig();
  if (!ghlConfigured(ghl)) return { ok: true, message: "Terminal not configured — nothing to settle" };
  return settleOnTerminal();
}
