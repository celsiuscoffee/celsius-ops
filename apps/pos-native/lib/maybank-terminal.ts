/**
 * Maybank terminal payment integration (STUB).
 *
 * Until the real Maybank MAPI / DTMC terminal SDK is wired up, this
 * module shape lets the checkout flow drive a card payment via a
 * single Promise — UI doesn't change when we swap the implementation.
 *
 * The real integration would either:
 *   - Bluetooth-pair an external Maybank EDC and exchange APDUs, OR
 *   - Call Maybank's online card-not-present API with tokenised cards
 *
 * For now this resolves after a short delay with a synthetic "approved"
 * response so the cashier flow can be tested end-to-end before the real
 * device or API key arrives. The downstream sale persists with
 * payment_method='card' and provider_ref=approval code, just like a
 * real Maybank EDC would supply.
 */
export type MaybankTerminalResult =
  | {
      status: "approved";
      approvalCode: string;
      cardBrand: "VISA" | "MASTERCARD" | "AMEX" | "MYDEBIT";
      maskedPan: string;
      txnRef: string;
    }
  | { status: "declined"; reason: string }
  | { status: "cancelled" };

/** Prompt the terminal for a card payment of the given amount (sen).
 *  Returns the terminal's verdict. Cashier UI should show "Insert card
 *  on terminal" while this is pending. */
export async function chargeMaybankCard(amountSen: number): Promise<MaybankTerminalResult> {
  // TODO: replace with real Maybank terminal SDK call. Expected wiring:
  //   1. Pair / connect to the EDC over Bluetooth (one-time, in Settings)
  //   2. Send SALE command with amountSen + invoice ref
  //   3. Stream status updates (idle → prompt → reading → online → result)
  //   4. Receive approval/decline + capture the receipt-printable fields
  await new Promise((r) => setTimeout(r, 2500));
  // Stub: always approves with a synthetic ref so cashiers can rehearse
  // the flow. Swap to a real call when Maybank credentials land.
  return {
    status: "approved",
    approvalCode: `APR-${Math.floor(Math.random() * 900000 + 100000)}`,
    cardBrand: "VISA",
    maskedPan: "**** **** **** 4242",
    txnRef: `MBB-${Date.now().toString().slice(-10)}`,
  };
}
