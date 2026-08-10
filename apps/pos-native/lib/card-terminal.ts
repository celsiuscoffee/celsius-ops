import { apiPost } from "./api";
import type { BranchSettings } from "./settings";

/**
 * Card terminal abstraction for the register's "Card Payment" method.
 *
 * Three outcomes drive three different register screens:
 *
 *  INTEGRATED — the outlet has a GHL (NTT DATA) terminal bound in BO POS
 *    Settings (ghl_terminal_id). The till asks the backoffice
 *    /api/pos/ghl/charge to drive the terminal and waits for the verdict.
 *    Credentials + the actual GHL ECR call live server-side only.
 *
 *  MANUAL — no integrated terminal, or the server explicitly answered
 *    "I did nothing" (501 GHL_NOT_CONFIGURED / GHL_NOT_IMPLEMENTED). The
 *    cashier charges the standalone card terminal as usual, then keys the
 *    approval code off the terminal slip. This replaces the old
 *    chargeMaybankCard stub, which auto-"approved" after 2.5s without any
 *    real charge.
 *
 *  UNKNOWN — the charge MAY have been dispatched to the terminal but the
 *    till never saw the verdict (timeout, network drop mid-call, 5xx, or
 *    a malformed "approved" response). Never silently degrade this to
 *    MANUAL: the customer may already be charged, and re-charging on the
 *    standalone terminal would double-charge them. The register shows a
 *    dedicated "check the terminal" screen instead.
 */

export type CardBrand = "VISA" | "MASTERCARD" | "AMEX" | "MYDEBIT";

export type CardApproval = {
  approvalCode: string;
  cardBrand: CardBrand;
  /** "—" for manual entries — the terminal slip stays the source of truth. */
  maskedPan: string;
  txnRef: string;
};

export type CardChargeResult =
  | ({ status: "approved" } & CardApproval)
  | { status: "declined"; reason: string }
  /** Provably no charge attempted — safe to show the manual-entry screen. */
  | { status: "manual_required"; reason: string }
  /** Charge outcome unknown — cashier must check the physical terminal. */
  | { status: "unknown"; reason: string };

/** True when BO POS Settings has an integrated GHL terminal for this outlet. */
export function hasIntegratedTerminal(s: BranchSettings | null): boolean {
  return !!s?.ghl_terminal_id;
}

/** A real tap → PIN → online-auth cycle on the terminal runs 15–60s, so the
 *  charge call gets a much longer leash than the 8s apiPost default. */
const CHARGE_TIMEOUT_MS = 90_000;

export async function chargeCard(
  amountSen: number,
  settings: BranchSettings | null,
  outletId: string | null,
): Promise<CardChargeResult> {
  if (!outletId || !hasIntegratedTerminal(settings)) {
    return { status: "manual_required", reason: "no integrated terminal configured" };
  }
  // Per-attempt idempotency ref — the server can dedupe a retry of the same
  // attempt instead of firing a second SALE at the terminal.
  const chargeRef = `CHG-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
  try {
    const res = await apiPost<{
      status: "approved" | "declined";
      approvalCode?: string;
      cardBrand?: CardBrand;
      maskedPan?: string;
      txnRef?: string;
      reason?: string;
    }>(
      "/api/pos/ghl/charge",
      {
        outlet_id: outletId,
        terminal_id: settings?.ghl_terminal_id,
        amount_sen: amountSen,
        charge_ref: chargeRef,
      },
      CHARGE_TIMEOUT_MS,
    );
    if (res.status === "approved" && res.approvalCode && res.txnRef) {
      return {
        status: "approved",
        approvalCode: res.approvalCode,
        cardBrand: res.cardBrand ?? "VISA",
        maskedPan: res.maskedPan ?? "—",
        txnRef: res.txnRef,
      };
    }
    if (res.status === "declined") {
      return { status: "declined", reason: res.reason ?? "Declined by terminal" };
    }
    // A 200 "approved" missing its mandatory fields is NOT safe to treat as
    // "no charge" — the terminal may well have charged. Surface as unknown.
    return { status: "unknown", reason: "malformed terminal response" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // The stub route answers 501 with these markers BEFORE touching any
    // terminal — the only failure modes that provably did nothing.
    if (msg.includes("GHL_NOT_CONFIGURED") || msg.includes("GHL_NOT_IMPLEMENTED") || /^501 /.test(msg)) {
      return { status: "manual_required", reason: "GHL integration not configured" };
    }
    // Timeout / network drop / 5xx — the SALE may have reached the terminal.
    return { status: "unknown", reason: msg };
  }
}
