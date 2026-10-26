import { describe, it, expect } from "vitest";
import { canonicalPhone, phoneVariants } from "./phone";

// The Orders tab regression (Jun–Oct 2026): app orders were written with the
// phone exactly as the client sent it, while the Orders tab looked customers
// up under "+60…" only. 36 customers whose app held their number as "0…" saw
// "No orders yet" for orders they had paid for — a screen that looked like the
// old pre-tabs build, so it was chased for months as an OTA problem.
//
// The invariant that was broken, and that these tests pin: a row written from
// ANY input form must be found by a lookup made from ANY input form.

const FORMS = ["+60123456789", "60123456789", "0123456789", "012-345 6789", "+60 12-345 6789"];

describe("canonicalPhone", () => {
  it("maps every Malaysian form of a number to one E.164 value", () => {
    for (const f of FORMS) expect(canonicalPhone(f)).toBe("+60123456789");
  });

  it("is idempotent", () => {
    const once = canonicalPhone("0123456789");
    expect(canonicalPhone(once)).toBe(once);
  });
});

describe("write-any / read-any round trip", () => {
  it("finds a row written from any form via a lookup from any form", () => {
    for (const writtenAs of FORMS) {
      const stored = canonicalPhone(writtenAs); // what the write paths now store
      for (const lookedUpAs of FORMS) {
        const variants = phoneVariants(canonicalPhone(lookedUpAs)); // what /api/loyalty/orders queries
        expect(variants, `written ${writtenAs}, looked up ${lookedUpAs}`).toContain(stored);
      }
    }
  });

  it("still finds LEGACY rows stored raw as \"0…\" (the 67 hidden app orders)", () => {
    // Rows written before canonicalisation keep their raw form until backfilled;
    // the read path must reach them from the app's canonical "+60…" lookup.
    const legacyStored = "0123456789";
    expect(phoneVariants(canonicalPhone("+60123456789"))).toContain(legacyStored);
  });

  it("does not match a different customer's number", () => {
    expect(phoneVariants(canonicalPhone("0123456789"))).not.toContain("+60123456780");
  });
});

describe("account deletion scrub (members/delete)", () => {
  // The scrub used to try only [member.phone, "60…", "+60…"], so orders
  // stored as "0…" kept the deleted customer's name/phone/email attached.
  it("covers every shape the old scrub tried, plus the \"0…\" form it missed", () => {
    const shapes = phoneVariants("+60123456789");
    for (const old of ["+60123456789", "60123456789"]) expect(shapes).toContain(old);
    expect(shapes).toContain("0123456789");
  });
});

