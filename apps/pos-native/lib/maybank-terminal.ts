/**
 * Terminal payment front-door for the checkout flow.
 *
 * Two terminal vendors exist in this codebase and they share no wire format.
 * This picks one per till, in order:
 *
 *   1. GHL / NTT Data ADAPTIS (lib/ghl-terminal.ts) — the one actually on site
 *      at Putrajaya and Shah Alam. Binary TLV framing, no ACK.
 *   2. Maybank X990 (lib/maybank-ecr.ts) — JSON, ACK-then-poll. Still blocked
 *      on the vendor's line-encryption spec.
 *   3. The rehearsal stub, when neither is configured. Its approvals are
 *      flagged `simulated` so the UI can label them and nobody mistakes one
 *      for a real charge.
 *
 * Original Maybank notes follow.
 *
 * When the ECR link is configured in Settings → Maybank Terminal (X990 on the
 * outlet LAN — see lib/maybank-ecr.ts), a charge drives the REAL terminal via
 * ECR-over-TCP using SALE_CARD_QR, so one "charge" accepts either a card
 * (tap/insert/swipe) or a DuitNow/wallet QR at the terminal. When it is NOT
 * configured, the old rehearsal stub answers instead — clearly marked so a
 * synthetic approval can never be mistaken for a real one.
 */
import { loadEcrConfig, ecrConfigured, ecrTransaction, type EcrOutcome } from "./maybank-ecr";
import { loadGhlConfig, ghlConfigured, chargeOnTerminal, settleOnTerminal, type GhlOutcome } from "./ghl-terminal";

export type MaybankTerminalResult =
  | {
      status: "approved";
      approvalCode: string;
      cardBrand: string;
      maskedPan: string;
      txnRef: string;
      /** true = rehearsal stub, NOT a real charge. UI must label it. */
      simulated?: boolean;
      /** DUITNOWQR when the customer paid by QR at the terminal. */
      entry?: string;
      /** false = terminal reply signature unverified — UI warns the cashier. */
      signatureVerified?: boolean;
    }
    /** The reference we put on the terminal slip, so a cashier comparing the
     *  till against the printed slip can match them. */
  | { status: "declined"; reason: string }
  | { status: "cancelled" }
  | { status: "error"; code: string; message: string };

function fromEcr(o: EcrOutcome): MaybankTerminalResult {
  switch (o.status) {
    case "approved":
      return {
        status: "approved",
        approvalCode: o.approvalCode,
        cardBrand: o.issuer || o.host || "CARD",
        maskedPan: o.maskedPan ?? (o.entry === "DUITNOWQR" ? "DuitNow QR" : ""),
        txnRef: o.rrn,
        entry: o.entry,
        signatureVerified: o.signatureVerified,
      };
    case "declined":
      return { status: "declined", reason: o.reason };
    case "cancelled":
      return { status: "cancelled" };
    case "timeout":
      return { status: "error", code: "ECR_TIMEOUT", message: "No result from terminal — check the terminal screen before retrying" };
    case "error":
      return { status: "error", code: o.code, message: o.message };
  }
}

/** GHL verdicts map onto the same result type. Note "unknown" becomes an
 *  `error`, NOT a decline: the register renders errors as the amber
 *  "Check the terminal" screen, which is exactly right for an outcome we
 *  cannot establish — it never tells a cashier the customer was not charged. */
function fromGhl(o: GhlOutcome & { ecrRef: string }): MaybankTerminalResult {
  switch (o.status) {
    case "approved":
      return {
        status: "approved",
        approvalCode: o.approvalCode,
        cardBrand: o.issuer ?? "CARD",
        maskedPan: o.maskedPan ?? (o.entry === "DUITNOWQR" ? "DuitNow QR" : ""),
        txnRef: o.rrn || o.ecrRef,
        entry: o.entry ?? undefined,
      };
    case "declined":
      return { status: "declined", reason: o.reason };
    case "unknown":
      return { status: "error", code: "GHL_UNKNOWN", message: o.reason };
  }
}

/** Charge on the terminal: card OR DuitNow QR (SALE_CARD_QR).
 *  `onStatus` streams the terminal's live state into the checkout UI. */
export async function chargeMaybankCard(
  amountSen: number,
  onStatus?: (s: string) => void,
  orderNo?: string,
): Promise<MaybankTerminalResult> {
  // GHL first — it is the terminal actually deployed at the outlets.
  const ghl = await loadGhlConfig();
  if (ghlConfigured(ghl)) {
    return fromGhl(await chargeOnTerminal({ amountSen, orderNo, onStatus }));
  }
  const cfg = await loadEcrConfig();
  if (ecrConfigured(cfg)) {
    return fromEcr(await ecrTransaction({ cfg, txn: "SALE_CARD_QR", amountSen, onStatus }));
  }
  // ── Rehearsal stub (terminal not configured) ──
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

/** DuitNow QR only (terminal displays the QR / scans the customer's). */
export async function chargeDuitNowQr(
  amountSen: number,
  onStatus?: (s: string) => void,
): Promise<MaybankTerminalResult> {
  const ghl = await loadGhlConfig();
  if (ghlConfigured(ghl)) {
    return fromGhl(await chargeOnTerminal({ amountSen, duitnowQr: true, onStatus }));
  }
  const cfg = await loadEcrConfig();
  if (!ecrConfigured(cfg)) {
    return { status: "error", code: "ECR_REJECTED", message: "Terminal not configured (Settings → GHL Terminal)" };
  }
  return fromEcr(await ecrTransaction({ cfg, txn: "QRSALE", amountSen, onStatus }));
}

/** End-of-day settlement — call from store close. Best-effort: settlement can
 *  also be run on the terminal itself, so a failure here must never block the
 *  Z-report close. */
export async function settleTerminal(): Promise<{ ok: boolean; message: string }> {
  const ghl = await loadGhlConfig();
  if (ghlConfigured(ghl)) return settleOnTerminal();
  const cfg = await loadEcrConfig();
  if (!ecrConfigured(cfg)) return { ok: true, message: "Terminal not configured — nothing to settle" };
  const out = await ecrTransaction({ cfg, txn: "SETTLE", timeoutMs: 180_000 });
  if (out.status === "approved") return { ok: true, message: "Settlement complete" };
  if (out.status === "error") return { ok: false, message: out.message };
  if (out.status === "declined") return { ok: false, message: out.reason };
  return { ok: false, message: `Settlement ${out.status}` };
}
