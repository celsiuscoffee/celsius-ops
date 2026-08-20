/**
 * Maybank terminal payment front-door for the checkout flow.
 *
 * When the ECR link is configured in Settings → Maybank Terminal (X990 on the
 * outlet LAN — see lib/maybank-ecr.ts), a charge drives the REAL terminal via
 * ECR-over-TCP using SALE_CARD_QR, so one "charge" accepts either a card
 * (tap/insert/swipe) or a DuitNow/wallet QR at the terminal. When it is NOT
 * configured, the old rehearsal stub answers instead — clearly marked so a
 * synthetic approval can never be mistaken for a real one.
 */
import { loadEcrConfig, ecrConfigured, ecrTransaction, type EcrOutcome } from "./maybank-ecr";

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

/** Charge on the terminal: card OR DuitNow QR (SALE_CARD_QR).
 *  `onStatus` streams the terminal's live state into the checkout UI. */
export async function chargeMaybankCard(
  amountSen: number,
  onStatus?: (s: string) => void,
): Promise<MaybankTerminalResult> {
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
  const cfg = await loadEcrConfig();
  if (!ecrConfigured(cfg)) {
    return { status: "error", code: "ECR_REJECTED", message: "Terminal not configured (Settings → Maybank Terminal)" };
  }
  return fromEcr(await ecrTransaction({ cfg, txn: "QRSALE", amountSen, onStatus }));
}

/** End-of-day settlement — call from store close. Best-effort: settlement can
 *  also be run on the terminal itself, so a failure here must never block the
 *  Z-report close. */
export async function settleTerminal(): Promise<{ ok: boolean; message: string }> {
  const cfg = await loadEcrConfig();
  if (!ecrConfigured(cfg)) return { ok: true, message: "Terminal not configured — nothing to settle" };
  const out = await ecrTransaction({ cfg, txn: "SETTLE", timeoutMs: 180_000 });
  if (out.status === "approved") return { ok: true, message: "Settlement complete" };
  if (out.status === "error") return { ok: false, message: out.message };
  if (out.status === "declined") return { ok: false, message: out.reason };
  return { ok: false, message: `Settlement ${out.status}` };
}
