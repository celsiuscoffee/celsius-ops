import { describe, it, expect } from "vitest";
import {
  buildSale, buildVoid, buildQueryStatus, buildReprint, buildSettlement,
  decodeFrame, encodeAmountBcd, decodeAmountBcd, crc16Arc, toHex, fromHex,
  GhlCommand, GhlTag, PRODUCT_DUITNOW_QR,
} from "../ghl/frame";

/**
 * Vendor-published sample frames (GHL / NTT Data, "Device Interface"),
 * supplied verbatim by the integration contact. These are the ground truth:
 * if our encoder reproduces every one byte-for-byte, the framing, the BCD
 * amount encoding and the recovered CRC-16/ARC are all correct.
 *
 * ECR refs INV260408001 (card) / INV260408002 (DuitNow), amount RM0.10.
 */
const SAMPLES = {
  saleCard:    "02000C010B01A100001AC0010006000000000010C013000C494E56323630343038303031033E03",
  voidCard:    "02000C010B01A200001AC0010006000000000010C013000C494E56323630343038303031F33D03",
  reprintCard: "02000C010B01E600001AC0010006000000000010C013000C494E56323630343038303031F34A03",
  saleDuitNow: "02000C010B01A1000028C0010006000000000010C013000C494E56323630343038303032C01A000A445549544E4F572051524AAB03",
  queryStatus: "02000C010B01E300001AC0010006000000000010C013000C494E56323630343038303032A20C03",
  voidDuitNow: "02000C010B01A200001AC0010006000000000010C013000C494E56323630343038303032F27D03",
  settlement:  "02000C010B01A30000006A0E03",
};

const REF_CARD = "INV260408001";
const REF_QR = "INV260408002";
const TEN_SEN = 10;

describe("GHL frame encoder vs vendor samples", () => {
  it("card sale matches byte-for-byte", () => {
    expect(toHex(buildSale({ amountSen: TEN_SEN, ecrRef: REF_CARD }))).toBe(SAMPLES.saleCard);
  });

  it("DuitNow QR sale matches — the only delta is the product-id tag", () => {
    expect(
      toHex(buildSale({ amountSen: TEN_SEN, ecrRef: REF_QR, productId: PRODUCT_DUITNOW_QR })),
    ).toBe(SAMPLES.saleDuitNow);
  });

  it("void, reprint, query-status and settlement all match", () => {
    expect(toHex(buildVoid({ amountSen: TEN_SEN, ecrRef: REF_CARD }))).toBe(SAMPLES.voidCard);
    expect(toHex(buildVoid({ amountSen: TEN_SEN, ecrRef: REF_QR }))).toBe(SAMPLES.voidDuitNow);
    expect(toHex(buildReprint({ amountSen: TEN_SEN, ecrRef: REF_CARD }))).toBe(SAMPLES.reprintCard);
    expect(toHex(buildQueryStatus({ amountSen: TEN_SEN, ecrRef: REF_QR }))).toBe(SAMPLES.queryStatus);
    expect(toHex(buildSettlement())).toBe(SAMPLES.settlement);
  });
});

describe("CRC-16/ARC", () => {
  it("validates every sample frame", () => {
    for (const [name, hex] of Object.entries(SAMPLES)) {
      const d = decodeFrame(fromHex(hex));
      expect(d.crcValid, `${name} CRC`).toBe(true);
    }
  });

  it("catches a single flipped bit in the payload", () => {
    const bytes = fromHex(SAMPLES.saleCard);
    bytes[20] ^= 0x01; // corrupt inside the amount field
    expect(decodeFrame(bytes).crcValid).toBe(false);
  });

  it("matches the published CRC-16/ARC check vector", () => {
    // "123456789" → 0xBB3D for CRC-16/ARC.
    expect(crc16Arc(new TextEncoder().encode("123456789"))).toBe(0xbb3d);
  });
});

describe("amount encoding (6-byte BCD, sen)", () => {
  it("round-trips RM0.10 and realistic basket totals", () => {
    expect(toHex(encodeAmountBcd(10))).toBe("000000000010");
    expect(toHex(encodeAmountBcd(3280))).toBe("000000003280"); // RM32.80, a real order
    for (const sen of [0, 1, 999, 3280, 123456, 999999999999]) {
      expect(decodeAmountBcd(encodeAmountBcd(sen))).toBe(sen);
    }
  });

  it("rejects negatives, fractions and overflow rather than silently truncating", () => {
    expect(() => encodeAmountBcd(-1)).toThrow();
    expect(() => encodeAmountBcd(10.5)).toThrow();
    expect(() => encodeAmountBcd(1_000_000_000_000)).toThrow();
  });
});

describe("decodeFrame", () => {
  it("reads back command and TLVs from the DuitNow sale", () => {
    const d = decodeFrame(fromHex(SAMPLES.saleDuitNow));
    expect(d.command).toBe(GhlCommand.SALE);
    const tags = d.tlvs.map((t) => t.tag);
    expect(tags).toEqual([GhlTag.AMOUNT, GhlTag.ECR_REF, GhlTag.PRODUCT_ID]);
    expect(decodeAmountBcd(d.tlvs[0].value)).toBe(TEN_SEN);
    expect(new TextDecoder().decode(d.tlvs[1].value)).toBe(REF_QR);
    expect(new TextDecoder().decode(d.tlvs[2].value)).toBe(PRODUCT_DUITNOW_QR);
  });

  it("handles the empty-TLV settlement frame", () => {
    const d = decodeFrame(fromHex(SAMPLES.settlement));
    expect(d.command).toBe(GhlCommand.SETTLEMENT);
    expect(d.tlvs).toEqual([]);
  });

  it("throws on malformed frames instead of guessing", () => {
    expect(() => decodeFrame(fromHex("0200"))).toThrow(/too short/);
    const badStx = fromHex(SAMPLES.saleCard); badStx[0] = 0x99;
    expect(() => decodeFrame(badStx)).toThrow(/STX/);
    const badEtx = fromHex(SAMPLES.saleCard); badEtx[badEtx.length - 1] = 0x99;
    expect(() => decodeFrame(badEtx)).toThrow(/ETX/);
  });
});
