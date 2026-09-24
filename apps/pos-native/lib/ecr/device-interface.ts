// NTT DATA (GHL) POS/ECR Extended Device Interface, spec 2.9.26.
//
// This is the protocol NTT DATA's engineer told us to use for the ADAPTIS
// on our counter, and his two remarks only make sense here: "TCP ECR not
// support ACK" is this envelope's ACK indicator, and "Duitnow QR Product
// ID is DUITNOW QR" is tag C01A. The other codec in this folder
// (protocol.ts) is IT BizFlow's JSON one, which the terminal also
// half-answers; keep both until a live transaction settles which is real.
//
// NOT YET USABLE: section 4.2 says the message data is appended with its
// CRC and then ENCRYPTED with an eTSK session key. That key comes from a
// registration and key exchange (commands E1, D1, D2) whose vendor id and
// initial key only NTT DATA can supply. The framing, the CRC and the
// fields below are all verified against the spec's own samples and are
// ready for the moment those arrive.
//
// The terminal on the counter and the POS speak this over a socket. A
// message is a framed, CRC-checked envelope around a list of tag-length-
// value fields:
//
//   STX  seq  src  dst  cmd  ack/status  len  data...  crc  etx
//   1    1    2    2    1    1           2    len      2    1
//
// The length counts the data only. CRC-16 covers everything between STX
// and the CRC. Numeric fields are packed decimal (two digits a byte), text
// fields are plain ASCII. This file is the codec and nothing else: no
// sockets, no timers, no app state, so the samples in the spec can be run
// against it as tests.
//
// We are on the "Payhere ECR" flavour (the terminal NTT DATA is sending
// us): its batch number, card type and TVR come back as text where
// "Payhere Direct" would pack them, and it alone has Product ID and Check
// Status, both of which the DuitNow QR flow needs.

export const STX = 0x02;
export const ETX = 0x03;
/** who is talking: the POS is an ECR, the terminal is the first device */
export const ECR = 0x0c01;
export const TERMINAL = 0x0b01;

/** what the message asks for (spec 6.1) */
export const CMD = {
  sale: 0xa1,
  void: 0xa2,
  settleCard: 0xa3,
  settleCash: 0xa4,
  manualInquiry: 0xa5,
  netsSale: 0xa6,
  refund: 0xb1,
  cancellation: 0xc1,
  notify: 0xc2,
  echo: 0xc3,
  getLastSettlement: 0xc5,
  ping: 0xc6,
  printDayTotal: 0xe2,
  checkStatus: 0xe3,
  preauth: 0xe4,
  saleCompletion: 0xe5,
  reprint: 0xe6,
  readCard: 0xe7,
} as const;
export type CommandName = keyof typeof CMD;
export const COMMAND_NAME: Record<number, CommandName> = Object.fromEntries(
  Object.entries(CMD).map(([k, v]) => [v, k as CommandName]),
) as Record<number, CommandName>;

/** 0x10 asks the terminal to acknowledge first; over TCP it does not (NTT DATA, 2026-07) */
export const ACK_NONE = 0x00;
export const ACK_REQUIRED = 0x10;

/** how the terminal answers (spec 6.3); anything 0x01 to 0x63 is the bank's own decline */
export const STATUS = {
  ok: 0x00,
  bankTimeout: 0xb0,
  deviceTimeout: 0xc0,
  cardNotSupported: 0xc1,
  amountExceeded: 0xc2,
  noTransaction: 0xc3,
  cardDeclined: 0xc4,
  alreadyVoided: 0xc5,
  memoryFull: 0xc6,
  cancelled: 0xc7,
  badEntryMode: 0xc8,
  settleFirst: 0xc9,
  commsError: 0xca,
  batchEmpty: 0xcb,
  settlementFailed: 0xcc,
  crcFailed: 0xd1,
  badFormat: 0xd2,
  badCommand: 0xd3,
  badRoute: 0xd4,
  missingTag: 0xd5,
  noAck: 0xd6,
  printReportFailed: 0xd8,
  badTid: 0xe8,
  badMid: 0xe9,
  pending: 0xea,
  outOfPaper: 0xef,
} as const;

/** what to tell the cashier when the terminal says no */
export const STATUS_TEXT: Record<number, string> = {
  [STATUS.ok]: "Approved",
  [STATUS.bankTimeout]: "The bank did not answer in time",
  [STATUS.deviceTimeout]: "The terminal timed out waiting for the card",
  [STATUS.cardNotSupported]: "That card is not accepted",
  [STATUS.amountExceeded]: "Over the limit for this terminal",
  [STATUS.noTransaction]: "No such transaction on the terminal",
  [STATUS.cardDeclined]: "The card was declined",
  [STATUS.alreadyVoided]: "That payment is already voided",
  [STATUS.memoryFull]: "The terminal's memory is full: settle it",
  [STATUS.cancelled]: "Cancelled on the terminal",
  [STATUS.badEntryMode]: "The card was presented the wrong way",
  [STATUS.settleFirst]: "Settle the terminal before charging again",
  [STATUS.commsError]: "The terminal cannot reach the bank",
  [STATUS.batchEmpty]: "Nothing to settle",
  [STATUS.settlementFailed]: "The settlement failed",
  [STATUS.crcFailed]: "The terminal could not read the message",
  [STATUS.badFormat]: "The terminal could not read the message",
  [STATUS.badCommand]: "The terminal does not know that command",
  [STATUS.badRoute]: "The terminal rejected the route",
  [STATUS.missingTag]: "The message was missing a field",
  [STATUS.noAck]: "The terminal is waiting on the last reply",
  [STATUS.printReportFailed]: "No sales on that date to print",
  [STATUS.badTid]: "Wrong terminal ID",
  [STATUS.badMid]: "Wrong merchant ID",
  [STATUS.pending]: "Waiting for the guest to pay",
  [STATUS.outOfPaper]: "The terminal is out of paper",
};
export const statusText = (code: number): string =>
  STATUS_TEXT[code] ?? (code >= 0x01 && code <= 0x63 ? `The bank declined it (${String(code).padStart(2, "0")})` : `The terminal answered ${hex2(code)}`);

/** the fields a message carries (spec 4.4.2). `n` is packed decimal, `a` text, `b` raw. */
export const TAG = {
  amount: 0xc001,
  terminalId: 0xc002,
  merchantId: 0xc003,
  terminalInvoice: 0xc004,
  terminalBatch: 0xc005,
  dateTime: 0xc006,
  maskedPan: 0xc007,
  expiry: 0xc008,
  cardholder: 0xc009,
  approvalCode: 0xc00a,
  rrn: 0xc00b,
  aid: 0xc00c,
  appName: 0xc00d,
  tc: 0xc00e,
  tvr: 0xc00f,
  cvmMerchant: 0xc010,
  signature: 0xc011,
  cashierId: 0xc012,
  ecrInvoice: 0xc013,
  ecrCounter: 0xc014,
  voucher: 0xc015,
  commandId: 0xc016,
  cvmCustomer: 0xc017,
  accountNumber: 0xc018,
  reportDate: 0xc019,
  productId: 0xc01a,
  originalStatus: 0xc01b,
  originalMessage: 0xc01c,
  cardToken: 0xc01d,
  discount: 0xc020,
  serviceCharge: 0xc030,
  totalAmount: 0xc100,
  batchCount: 0xd000,
  statusCode: 0xd001,
  cardType: 0xd002,
  paymentType: 0xd003,
  notifyMessage: 0xd004,
  debitTotals: 0xd005,
  creditTotals: 0xd006,
  accountType: 0xd007,
  entryMode: 0xd008,
  hostName: 0xd00a,
  saleCount: 0xd010,
  saleAmount: 0xd011,
  refundCount: 0xd012,
  refundAmount: 0xd013,
  grossAmount: 0xd014,
  redemptionAmount: 0xd015,
  netAmount: 0xd016,
  transactionRef: 0xd017,
  productBrand: 0xd018,
  prompt: 0xd019,
  entryModeText: 0xd01a,
  transactionRef3: 0xd01b,
  hostDeviceId: 0xb008,
  reasonCode: 0xf001,
} as const;
export type TagName = keyof typeof TAG;
export const TAG_NAME: Record<number, TagName> = Object.fromEntries(
  Object.entries(TAG).map(([k, v]) => [v, k as TagName]),
) as Record<number, TagName>;

/** packed decimal fields; everything else on this terminal comes back as text */
const NUMERIC: ReadonlySet<number> = new Set<number>([
  TAG.amount, TAG.discount, TAG.serviceCharge, TAG.totalAmount, TAG.terminalInvoice,
  TAG.dateTime, TAG.expiry, TAG.ecrCounter, TAG.reportDate, TAG.batchCount,
  TAG.statusCode, TAG.accountType, TAG.entryMode, TAG.notifyMessage,
  TAG.saleCount, TAG.saleAmount, TAG.refundCount, TAG.refundAmount,
  TAG.grossAmount, TAG.redemptionAmount, TAG.netAmount,
]);
/** how many bytes a fixed-width numeric field takes */
const WIDTH: Partial<Record<number, number>> = {
  [TAG.amount]: 6, [TAG.discount]: 6, [TAG.serviceCharge]: 6, [TAG.totalAmount]: 6,
  [TAG.dateTime]: 5, [TAG.expiry]: 2, [TAG.ecrCounter]: 2, [TAG.reportDate]: 4,
  [TAG.saleAmount]: 6, [TAG.refundAmount]: 6,
  [TAG.grossAmount]: 6, [TAG.redemptionAmount]: 6, [TAG.netAmount]: 6,
  [TAG.saleCount]: 2, [TAG.refundCount]: 2,
};

export type Field = { tag: number; name: TagName | null; bytes: number[]; text: string; digits: string };
export type Message = {
  seq: number;
  source: number;
  destination: number;
  command: number;
  commandName: CommandName | null;
  /** the request's ACK indicator, or the response's status code */
  status: number;
  fields: Field[];
  /** every field by name, in the order they arrived */
  get(name: TagName): Field | undefined;
  digits(name: TagName): string | undefined;
  text(name: TagName): string | undefined;
  /** a money field as ringgit */
  money(name: TagName): number | undefined;
};

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

/** CRC-16 as the spec's C sample computes it, over everything after STX up to the CRC */
export function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b & 0xff;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

const bcd = (digits: string): number[] => {
  const even = digits.length % 2 ? `0${digits}` : digits;
  const out: number[] = [];
  for (let i = 0; i < even.length; i += 2) out.push(parseInt(even.slice(i, i + 2), 10));
  return out.map((n, i) => {
    const pair = even.slice(i * 2, i * 2 + 2);
    return (Number(pair[0]) << 4) | Number(pair[1]);
  });
};
const unbcd = (bytes: readonly number[]): string =>
  bytes.map((b) => `${(b >> 4) & 0x0f}${b & 0x0f}`).join("");

/** a packed-decimal field of a fixed width, e.g. an amount in cents */
export const num = (tag: number, value: number | string, width?: number): Field => {
  const raw = String(typeof value === "number" ? Math.round(value) : value).replace(/\D/g, "");
  // a fixed-width field is padded to its width; the rest (the terminal's own
  // invoice number, N..10) go out at the length they came in at
  const w = width ?? WIDTH[tag] ?? Math.max(1, Math.ceil(raw.length / 2));
  const digits = raw.padStart(w * 2, "0").slice(-w * 2);
  return field(tag, bcd(digits));
};
/** an amount in ringgit, sent as cents */
export const money = (tag: number, ringgit: number): Field => num(tag, Math.round(ringgit * 100));
/** a text field, e.g. the POS's own invoice number */
export const text = (tag: number, value: string): Field =>
  field(tag, [...value].map((c) => c.charCodeAt(0) & 0xff));

export function field(tag: number, bytes: readonly number[]): Field {
  const b = [...bytes];
  return {
    tag,
    name: TAG_NAME[tag] ?? null,
    bytes: b,
    text: b.map((n) => String.fromCharCode(n)).join(""),
    digits: unbcd(b),
  };
}

/** build a message ready for the socket */
export function encode(input: {
  command: number;
  fields?: readonly Field[];
  seq?: number;
  ack?: number;
  source?: number;
  destination?: number;
}): number[] {
  const data: number[] = [];
  for (const f of input.fields ?? []) {
    data.push((f.tag >> 8) & 0xff, f.tag & 0xff, (f.bytes.length >> 8) & 0xff, f.bytes.length & 0xff, ...f.bytes);
  }
  const src = input.source ?? ECR;
  const dst = input.destination ?? TERMINAL;
  const body = [
    input.seq ?? 0,
    (src >> 8) & 0xff, src & 0xff,
    (dst >> 8) & 0xff, dst & 0xff,
    input.command & 0xff,
    input.ack ?? ACK_NONE,
    (data.length >> 8) & 0xff, data.length & 0xff,
    ...data,
  ];
  const crc = crc16(body);
  return [STX, ...body, (crc >> 8) & 0xff, crc & 0xff, ETX];
}

/** the header is ten bytes, then the data, then two CRC bytes and ETX */
export const HEADER = 10;
/** how long the whole frame is, once at least the header has arrived */
export function frameLength(bytes: readonly number[]): number | null {
  if (bytes.length < HEADER) return null;
  return HEADER + ((bytes[8] << 8) | bytes[9]) + 3;
}

export type EcrErrorKind = "frame" | "crc" | "empty";
export class EcrError extends Error {
  kind: EcrErrorKind;
  // written out rather than a parameter property so the file still runs
  // under node's type stripping, which the terminal simulator relies on
  constructor(message: string, kind: EcrErrorKind = "frame") {
    super(message);
    this.name = "EcrError";
    this.kind = kind;
  }
}

/** read a message the terminal sent back */
export function decode(bytes: readonly number[]): Message {
  if (!bytes.length) throw new EcrError("The terminal sent nothing back", "empty");
  if (bytes[0] !== STX) throw new EcrError(`Expected STX, got ${hex2(bytes[0])}`);
  const total = frameLength(bytes);
  if (total === null || bytes.length < total) throw new EcrError("The terminal's reply was cut short");
  if (bytes[total - 1] !== ETX) throw new EcrError("The terminal's reply has no ETX");
  const body = bytes.slice(1, total - 3);
  const want = (bytes[total - 3] << 8) | bytes[total - 2];
  const got = crc16(body);
  if (want !== got) throw new EcrError("The terminal's reply failed its checksum", "crc");

  const dataLen = (bytes[8] << 8) | bytes[9];
  const data = bytes.slice(HEADER, HEADER + dataLen);
  const fields: Field[] = [];
  let i = 0;
  while (i + 4 <= data.length) {
    const tag = (data[i] << 8) | data[i + 1];
    const len = (data[i + 2] << 8) | data[i + 3];
    if (i + 4 + len > data.length) break; // a truncated tail is ignored, never guessed at
    fields.push(field(tag, data.slice(i + 4, i + 4 + len)));
    i += 4 + len;
  }
  const first = (name: TagName) => fields.find((f) => f.tag === TAG[name]);
  const command = bytes[6];
  return {
    seq: bytes[1],
    source: (bytes[2] << 8) | bytes[3],
    destination: (bytes[4] << 8) | bytes[5],
    command,
    commandName: COMMAND_NAME[command] ?? null,
    status: bytes[7],
    fields,
    get: first,
    digits: (name) => first(name)?.digits,
    text: (name) => first(name)?.text,
    money: (name) => {
      const f = first(name);
      return f ? Number(f.digits) / 100 : undefined;
    },
  };
}

/** a value of a field, read the way that field is defined */
export function value(f: Field): string {
  return NUMERIC.has(f.tag) ? f.digits : f.text;
}

export const toHex = (bytes: readonly number[]): string => bytes.map(hex2).join("");
export const fromHex = (hex: string): number[] => {
  const clean = hex.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
};
