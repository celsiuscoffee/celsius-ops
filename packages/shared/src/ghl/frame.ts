/**
 * GHL / NTT Data terminal — ECR frame codec ("Device Interface" protocol).
 *
 * Pure byte-level encode/decode, no transport: the TCP (or USB) plumbing lives
 * in the POS app. Kept here so it runs under vitest in CI, where the vendor's
 * own published sample frames serve as test vectors.
 *
 * ── Frame layout ────────────────────────────────────────────────────────────
 *   STX(0x02) │ header(5) │ CMD(1) │ rsv(2) │ tlvLen(1) │ TLV… │ CRC16(2) │ ETX(0x03)
 *
 * TLVs are tag(2) + length(2) + value, big-endian throughout.
 *
 * CRC is **CRC-16/ARC** (poly 0x8005, init 0x0000, reflected in and out, no
 * final xor) computed over everything from the header up to — but excluding —
 * the CRC itself, transmitted big-endian. This was not stated in the covering
 * email; it was recovered by fitting every published sample frame, and all
 * seven reproduce exactly (see frame.test.ts). Confirm against the Device
 * Interface spec when it arrives.
 *
 * ── Status: REQUEST path only ───────────────────────────────────────────────
 * Everything here is derived from the vendor's seven sample REQUEST frames.
 * The response-frame layout, result codes and timeouts are defined in
 * "Device Interface_V2.9.26_20260224", which we do not yet hold — so
 * `decodeFrame` deliberately returns the raw structure and does NOT interpret
 * results. Do not infer an approval from a decoded frame until that document
 * is in hand; a misread approval books an unpaid sale.
 *
 * NOTE: this is a DIFFERENT vendor from the Maybank/IT BizFlow X990 client in
 * apps/pos-native/lib/maybank-ecr.ts. That one is JSON with an ACK-then-poll
 * handshake; GHL is binary and, per the vendor, sends no ACK over TCP. The two
 * share no wire format — do not cross-wire them.
 */

export const STX = 0x02;
export const ETX = 0x03;

/** Fixed 5-byte preamble seen in every vendor sample. Meaning unconfirmed
 *  (likely length/version/channel); kept verbatim pending the spec. */
export const DEFAULT_HEADER = Uint8Array.from([0x00, 0x0c, 0x01, 0x0b, 0x01]);

/** Command codes confirmed by the vendor's samples. */
export const GhlCommand = {
  SALE: 0xa1,
  VOID: 0xa2,
  SETTLEMENT: 0xa3,
  QUERY_STATUS: 0xe3,
  REPRINT: 0xe6,
} as const;
export type GhlCommandName = keyof typeof GhlCommand;

/** TLV tags confirmed by the vendor's samples. */
export const GhlTag = {
  /** Transaction amount — 6-byte BCD, 12 digits, in sen. */
  AMOUNT: 0xc001,
  /** Our reference / invoice number echoed back on the slip. */
  ECR_REF: 0xc013,
  /** Payment product, e.g. "DUITNOW QR". Absent = ordinary card sale. */
  PRODUCT_ID: 0xc01a,
} as const;

/** Product id for DuitNow QR, exactly as the vendor specified (note the space). */
export const PRODUCT_DUITNOW_QR = "DUITNOW QR";

export type Tlv = { tag: number; value: Uint8Array };

// ── CRC-16/ARC ──────────────────────────────────────────────────────────────
// Bitwise rather than table-driven: frames are tens of bytes, so the table
// would cost more to justify than it saves.
export function crc16Arc(data: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

/** Amount in sen → the 6-byte BCD the terminal expects (RM0.10 → 00…0010). */
export function encodeAmountBcd(amountSen: number): Uint8Array {
  if (!Number.isInteger(amountSen) || amountSen < 0) {
    throw new RangeError(`amountSen must be a non-negative integer, got ${amountSen}`);
  }
  const digits = String(amountSen).padStart(12, "0");
  if (digits.length > 12) {
    throw new RangeError(`amount ${amountSen} exceeds the 12-digit field`);
  }
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    out[i] = (Number(digits[i * 2]) << 4) | Number(digits[i * 2 + 1]);
  }
  return out;
}

export function decodeAmountBcd(bytes: Uint8Array): number {
  let s = "";
  for (const b of bytes) s += String(b >> 4) + String(b & 0x0f);
  return Number(s);
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) throw new RangeError(`non-ASCII character in ECR field: ${JSON.stringify(s)}`);
    out[i] = c;
  }
  return out;
}

function encodeTlvs(tlvs: Tlv[]): Uint8Array {
  const total = tlvs.reduce((n, t) => n + 4 + t.value.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const { tag, value } of tlvs) {
    out[i++] = (tag >> 8) & 0xff;
    out[i++] = tag & 0xff;
    out[i++] = (value.length >> 8) & 0xff;
    out[i++] = value.length & 0xff;
    out.set(value, i);
    i += value.length;
  }
  return out;
}

/** Build a complete request frame, CRC included. */
export function encodeFrame(
  command: number,
  tlvs: Tlv[] = [],
  header: Uint8Array = DEFAULT_HEADER,
): Uint8Array {
  const body = encodeTlvs(tlvs);
  if (body.length > 0xff) {
    // The samples carry a single-byte TLV length; until the spec says how
    // longer payloads are framed, refuse rather than silently truncate.
    throw new RangeError(`TLV payload ${body.length}B exceeds the 1-byte length field`);
  }
  // header | cmd | rsv(2) | tlvLen | body — the CRC covers exactly this span.
  const covered = new Uint8Array(header.length + 4 + body.length);
  covered.set(header, 0);
  covered[header.length] = command;
  covered[header.length + 1] = 0x00;
  covered[header.length + 2] = 0x00;
  covered[header.length + 3] = body.length;
  covered.set(body, header.length + 4);

  const crc = crc16Arc(covered);
  const frame = new Uint8Array(1 + covered.length + 3);
  frame[0] = STX;
  frame.set(covered, 1);
  frame[1 + covered.length] = (crc >> 8) & 0xff;
  frame[2 + covered.length] = crc & 0xff;
  frame[3 + covered.length] = ETX;
  return frame;
}

/** Sale. Pass `productId` (PRODUCT_DUITNOW_QR) for a DuitNow QR sale; omit it
 *  for an ordinary card sale — the only difference is the extra tag. */
export function buildSale(args: {
  amountSen: number;
  ecrRef: string;
  productId?: string;
}): Uint8Array {
  const tlvs: Tlv[] = [
    { tag: GhlTag.AMOUNT, value: encodeAmountBcd(args.amountSen) },
    { tag: GhlTag.ECR_REF, value: ascii(args.ecrRef) },
  ];
  if (args.productId) tlvs.push({ tag: GhlTag.PRODUCT_ID, value: ascii(args.productId) });
  return encodeFrame(GhlCommand.SALE, tlvs);
}

export function buildVoid(args: { amountSen: number; ecrRef: string }): Uint8Array {
  return encodeFrame(GhlCommand.VOID, [
    { tag: GhlTag.AMOUNT, value: encodeAmountBcd(args.amountSen) },
    { tag: GhlTag.ECR_REF, value: ascii(args.ecrRef) },
  ]);
}

/** Poll an in-flight transaction. Matters most for DuitNow QR, which is
 *  asynchronous — the customer may scan seconds or minutes after the prompt. */
export function buildQueryStatus(args: { amountSen: number; ecrRef: string }): Uint8Array {
  return encodeFrame(GhlCommand.QUERY_STATUS, [
    { tag: GhlTag.AMOUNT, value: encodeAmountBcd(args.amountSen) },
    { tag: GhlTag.ECR_REF, value: ascii(args.ecrRef) },
  ]);
}

export function buildReprint(args: { amountSen: number; ecrRef: string }): Uint8Array {
  return encodeFrame(GhlCommand.REPRINT, [
    { tag: GhlTag.AMOUNT, value: encodeAmountBcd(args.amountSen) },
    { tag: GhlTag.ECR_REF, value: ascii(args.ecrRef) },
  ]);
}

/** End-of-day settlement — carries no TLVs. */
export function buildSettlement(): Uint8Array {
  return encodeFrame(GhlCommand.SETTLEMENT, []);
}

export type DecodedFrame = {
  command: number;
  header: Uint8Array;
  reserved: Uint8Array;
  tlvs: Tlv[];
  /** CRC recomputed over the received bytes and matched against the frame. */
  crcValid: boolean;
};

/**
 * Parse a frame's structure. Structural only — it does NOT decide whether a
 * transaction was approved, because the response result codes are defined in
 * the spec we don't yet have. Throws on anything malformed rather than
 * guessing, and reports `crcValid` instead of trusting the payload.
 */
export function decodeFrame(frame: Uint8Array, headerLen = DEFAULT_HEADER.length): DecodedFrame {
  if (frame.length < headerLen + 8) throw new Error("frame too short");
  if (frame[0] !== STX) throw new Error(`bad STX 0x${frame[0].toString(16)}`);
  if (frame[frame.length - 1] !== ETX) throw new Error("bad ETX");

  const covered = frame.subarray(1, frame.length - 3);
  const got = (frame[frame.length - 3] << 8) | frame[frame.length - 2];
  const crcValid = crc16Arc(covered) === got;

  const header = covered.subarray(0, headerLen);
  const command = covered[headerLen];
  const reserved = covered.subarray(headerLen + 1, headerLen + 3);
  const tlvLen = covered[headerLen + 3];
  const body = covered.subarray(headerLen + 4);
  if (body.length !== tlvLen) {
    throw new Error(`TLV length mismatch: header says ${tlvLen}, got ${body.length}`);
  }

  const tlvs: Tlv[] = [];
  let i = 0;
  while (i < body.length) {
    if (i + 4 > body.length) throw new Error("truncated TLV header");
    const tag = (body[i] << 8) | body[i + 1];
    const len = (body[i + 2] << 8) | body[i + 3];
    if (i + 4 + len > body.length) throw new Error(`TLV ${tag.toString(16)} overruns frame`);
    tlvs.push({ tag, value: body.subarray(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return { command, header, reserved, tlvs, crcValid };
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2) throw new Error("odd-length hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
