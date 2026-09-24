// Every request the POS can put on the terminal, as bytes and nothing else.
//
// This exists because two things have to send byte-identical messages and
// must never drift: the POS itself, and the certification harness that runs
// NTT DATA's test script and hands back the request hex for each case. If
// the harness built its own frames it would certify itself rather than the
// POS.
//
// Nothing here talks to a network or holds state. Give it an amount and an
// invoice number, get a frame.
import {
  encode, CMD, TAG, ACK_NONE, money, num, text, type Field,
} from "./device-interface";

/** Which account a debit card draws on. Spec 6.4 packs it into tag D007 as
 *  Saving = 0x10, Current = 0x20, and 5.3.1 makes it mandatory for a debit
 *  transaction on the PayHere Direct build. We do not know a card is debit
 *  until it is read, so this is sent only when the caller says to: the
 *  certification script's MyDebit case, and eventually a cashier's choice. */
export type AccountType = "savings" | "current";
const ACCOUNT_CODE: Record<AccountType, number> = { savings: 10, current: 20 };

/** which of NTT DATA's two terminal builds is on the counter */
export type Flavour = "direct" | "ecr";

export type CommandOptions = {
  flavour: Flavour;
  /** The DuitNow product the terminal should run. NTT DATA's codes, from
   *  Ivan Choi by email: DUITNOWDQR returns the QR as an image, DUITNOWQRC
   *  as a string. Measured against the real terminal on 2026-09-23: a real
   *  code is recognised and answered in about a second, with entry mode
   *  "Scan" and brand "GHL MAH"; anything else is not recognised and the
   *  terminal sits for fifteen seconds before cancelling. That difference
   *  is how you tell a wrong code from a product that is not enabled. */
  qrProductId?: string;
  /** Older terminals take a payment type instead of a product. Only used
   *  when no product id is set: on our ADAPTIS "CD" was never recognised. */
  qrPaymentType?: string;
  /** the guest shows their own wallet QR and the terminal scans it */
  scanPaymentType?: string;
};

export const DEFAULT_OPTIONS: CommandOptions = {
  flavour: "direct",
  qrProductId: "DUITNOWQRC",
  qrPaymentType: "",
  scanPaymentType: "CD",
};

/** card, the guest's own wallet code, or a DuitNow QR on the terminal's screen */
export type Method = "card" | "ewallet" | "qr_pay";

const base = (ringgit: number, ecrInvoice: string): Field[] =>
  [money(TAG.amount, ringgit), text(TAG.ecrInvoice, ecrInvoice)];

/** is the terminal there (spec 5.1) */
export const echoRequest = (): number[] =>
  encode({ command: CMD.echo, ack: ACK_NONE });

/** the guest is paying (5.2) */
export function saleRequest(input: {
  ringgit: number;
  ecrInvoice: string;
  method: Method;
  cashierId?: string;
  /** required for a debit card on the Direct build (spec 5.3.1) */
  accountType?: AccountType;
  options?: Partial<CommandOptions>;
}): number[] {
  const o = { ...DEFAULT_OPTIONS, ...input.options };
  const fields = base(input.ringgit, input.ecrInvoice);
  if (input.accountType) fields.push(num(TAG.accountType, ACCOUNT_CODE[input.accountType]));
  if (input.cashierId) fields.push(text(TAG.cashierId, input.cashierId.slice(0, 20)));
  // DuitNow is chosen by product id on both builds. The flavour used to
  // decide this, and on the Direct build we sent a payment type instead:
  // the terminal never recognised it. The payment type is kept only as a
  // fallback for a terminal that has no product configured.
  if (input.method === "qr_pay") {
    if (o.qrProductId) fields.push(text(TAG.productId, o.qrProductId));
    else if (o.qrPaymentType) fields.push(text(TAG.paymentType, o.qrPaymentType));
  }
  if (input.method === "ewallet" && o.scanPaymentType) fields.push(text(TAG.paymentType, o.scanPaymentType));
  return encode({ command: CMD.sale, fields, ack: ACK_NONE });
}

/** take a payment back off the terminal, by our own invoice number (5.3) */
export const voidRequest = (ringgit: number, ecrInvoice: string): number[] =>
  encode({ command: CMD.void, fields: base(ringgit, ecrInvoice), ack: ACK_NONE });

/** what became of an attempt we lost sight of: Manual Inquiry on the Direct
 *  build (5.9), Check Status on the ECR one (5.11) */
export const queryRequest = (ringgit: number, ecrInvoice: string, flavour: Flavour = "direct"): number[] =>
  encode({
    command: flavour === "ecr" ? CMD.checkStatus : CMD.manualInquiry,
    fields: base(ringgit, ecrInvoice),
    ack: ACK_NONE,
  });

/** hold an amount on the card without taking it (5.13). NTT DATA's script
 *  requires this even where the floor never uses it. */
export const preauthRequest = (ringgit: number, ecrInvoice: string): number[] =>
  encode({ command: CMD.preauth, fields: base(ringgit, ecrInvoice), ack: ACK_NONE });

/** take the held amount (5.14). The script is explicit that a completion
 *  carries the transaction reference and nothing else to identify it. */
export const completionRequest = (ringgit: number, transactionRef: string): number[] =>
  encode({
    command: CMD.saleCompletion,
    fields: [money(TAG.amount, ringgit), text(TAG.transactionRef, transactionRef)],
    ack: ACK_NONE,
  });

/** print the last transaction's slip again, which is also how a POS that
 *  lost the reply finds out what the terminal did (5.15) */
export const reprintRequest = (ringgit: number, ecrInvoice: string): number[] =>
  encode({ command: CMD.reprint, fields: base(ringgit, ecrInvoice), ack: ACK_NONE });

/** clear whatever is on the terminal's screen (5.6) */
export const cancelRequest = (): number[] =>
  encode({ command: CMD.cancellation, ack: ACK_NONE });

/** close the batch and read its totals (5.4) */
export const settleRequest = (): number[] =>
  encode({ command: CMD.settleCard, ack: ACK_NONE });

/** the terminal's own totals for a day, printed on its printer (5.8) */
export const dayTotalRequest = (yyyymmdd: string): number[] =>
  encode({ command: CMD.printDayTotal, fields: [num(TAG.reportDate, yyyymmdd)], ack: ACK_NONE });
