import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/pos/ghl/charge — drive an outlet's GHL (NTT DATA) card
 * terminal for a register sale. INTEGRATION PENDING.
 *
 * GHL retailer account 6600031123 was onboarded 10 Jun 2026 but their ECR
 * credentials/spec haven't been issued yet, so this endpoint answers 501
 * GHL_NOT_CONFIGURED and the till (apps/pos-native/lib/card-terminal.ts)
 * falls back to manual approval-code entry. The till treats ONLY that
 * explicit 501 as "safe to go manual" — every other failure shows its
 * "outcome unknown — check the terminal" screen — so the contract below
 * must stay loud and precise.
 *
 * Contract (enforced NOW so the till's call shape is final before the real
 * implementation lands):
 *   - amount_sen: positive integer, capped (one register sale, not a wire)
 *   - charge_ref: per-attempt idempotency key from the till — the real
 *     implementation MUST dedupe on it (same ref → return the original
 *     attempt's verdict, never fire a second SALE at the terminal)
 *   - terminal_id is advisory: resolve + verify it server-side from
 *     pos_branch_settings (outlet_id) before charging; never trust the
 *     client's pairing of outlet→terminal
 *
 * Expected wiring once GHL issues credentials (env: GHL_API_BASE, GHL_API_KEY):
 *   1. validate outlet_id + terminal against pos_branch_settings
 *   2. send a SALE to GHL's cloud ECR for that terminal with amount_sen,
 *      keyed by charge_ref
 *   3. await/poll the verdict; normalize to
 *      { status, approvalCode, cardBrand, maskedPan, txnRef }
 *      — the exact shape lib/card-terminal.ts already consumes
 *   4. persist charge_ref + txnRef so settlement reconciliation can match
 *      the GHL batch and the till can re-query an aborted attempt
 *
 * Open POS endpoint (native till carries no session), same posture as
 * /api/pos/availability — Origin-checked by middleware.
 */

// One register sale, not a wire transfer. RM5,000 comfortably covers the
// largest plausible till ticket (catering pickups run ~RM1k).
const MAX_AMOUNT_SEN = 500_000;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    outlet_id?: unknown;
    terminal_id?: unknown;
    amount_sen?: unknown;
    charge_ref?: unknown;
  } | null;

  const outletId = typeof body?.outlet_id === "string" ? body.outlet_id : "";
  const terminalId = typeof body?.terminal_id === "string" ? body.terminal_id : "";
  const chargeRef = typeof body?.charge_ref === "string" ? body.charge_ref : "";
  const amountSen = body?.amount_sen;

  if (!outletId || !terminalId || !chargeRef) {
    return NextResponse.json(
      { error: "outlet_id, terminal_id, charge_ref, amount_sen required" },
      { status: 400 },
    );
  }
  if (typeof amountSen !== "number" || !Number.isInteger(amountSen) || amountSen <= 0 || amountSen > MAX_AMOUNT_SEN) {
    return NextResponse.json(
      { error: `amount_sen must be a positive integer ≤ ${MAX_AMOUNT_SEN}` },
      { status: 400 },
    );
  }

  if (!process.env.GHL_API_BASE || !process.env.GHL_API_KEY) {
    return NextResponse.json(
      { error: "GHL_NOT_CONFIGURED", detail: "GHL ECR credentials not yet provisioned" },
      { status: 501 },
    );
  }

  // Credentials exist but the ECR call isn't implemented — fail loud rather
  // than pretend. Implement against GHL's spec before setting the env vars.
  return NextResponse.json({ error: "GHL_NOT_IMPLEMENTED" }, { status: 501 });
}
