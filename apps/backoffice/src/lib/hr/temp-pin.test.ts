import { describe, it, expect } from "vitest";
import { tempPinFromIc, resolveTempPin, tempPinRefusal, TEMP_PIN_LENGTH } from "./temp-pin";

const free = async () => false;
const taken = async () => true;

describe("tempPinFromIc", () => {
  it("takes the first six digits — the date of birth", () => {
    // Shahidan 041221-06-0367 -> born 21 Dec 2004.
    expect(tempPinFromIc("041221060367")).toBe("041221");
    // Qistina 051130-14-1494 -> born 30 Nov 2005.
    expect(tempPinFromIc("051130141494")).toBe("051130");
  });

  it("ignores separators, so both stored IC formats work", () => {
    // Production holds both: 55 rows digits-only, 18 dashed.
    expect(tempPinFromIc("050310-10-1364")).toBe("050310");
    expect(tempPinFromIc("050310101364")).toBe("050310");
    expect(tempPinFromIc(" 050310 10 1364 ")).toBe("050310");
  });

  it("always returns exactly six digits", () => {
    const pin = tempPinFromIc("061027101581");
    expect(pin).toHaveLength(TEMP_PIN_LENGTH);
    expect(pin).toMatch(/^\d{6}$/);
  });

  it("refuses an IC that is not 12 digits rather than padding or truncating", () => {
    expect(tempPinFromIc("0503101013")).toBeNull();     // 10
    expect(tempPinFromIc("05031010136412")).toBeNull(); // 14
    expect(tempPinFromIc("")).toBeNull();
    expect(tempPinFromIc(null)).toBeNull();
    expect(tempPinFromIc(undefined)).toBeNull();
  });
});

describe("resolveTempPin", () => {
  it("returns the derived PIN when the IC is good and it is free", async () => {
    expect(await resolveTempPin("041221060367", free)).toEqual({ ok: true, pin: "041221" });
  });

  it("refuses when there is no IC — HR must choose a number", async () => {
    // 13 of 54 active staff have no usable IC, so this is the common path.
    expect(await resolveTempPin(null, free)).toEqual({ ok: false, reason: "no_ic" });
    expect(await resolveTempPin("   ", free)).toEqual({ ok: false, reason: "no_ic" });
  });

  it("refuses a malformed IC", async () => {
    expect(await resolveTempPin("12345", free)).toEqual({ ok: false, reason: "bad_ic" });
  });

  it("refuses rather than quietly choosing a different PIN when it is taken", async () => {
    // Two staff born the same day. Sliding to another number would leave HR
    // telling the new hire a PIN that is not theirs.
    expect(await resolveTempPin("041221060367", taken)).toEqual({ ok: false, reason: "taken" });
  });

  it("checks the exact derived PIN for collisions, not the whole IC", async () => {
    const seen: string[] = [];
    await resolveTempPin("050626070250", async (p) => { seen.push(p); return false; });
    expect(seen).toEqual(["050626"]);
  });
});

describe("tempPinRefusal", () => {
  it("tells the issuer what to do instead, for every reason", () => {
    for (const reason of ["no_ic", "bad_ic", "taken"] as const) {
      const msg = tempPinRefusal(reason);
      expect(msg).toMatch(/6-digit PIN/);
      expect(msg.length).toBeGreaterThan(20);
    }
  });
});
