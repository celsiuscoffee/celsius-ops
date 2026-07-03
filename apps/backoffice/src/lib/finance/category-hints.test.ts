import { describe, it, expect } from "vitest";
import { deriveHintPhrase } from "./category-hints";

describe("deriveHintPhrase", () => {
  it("extracts the payee from a remittance with reference noise", () => {
    expect(deriveHintPhrase("I2606-0155 GET RENTAL SDN. BHD* I2606-0155")).toBe("GET RENTAL");
  });

  it("strips transfer boilerplate and stops at reference tokens", () => {
    expect(deriveHintPhrase("TRANSFER FR A/C BADRUL AZMI BIN JAM Q1 2026 Divide")).toBe("BADRUL AZMI BIN JAM");
  });

  it("strips the glued 20-char CELSIUS sender prefix", () => {
    expect(deriveHintPhrase("CELSIUS COFFEE PUTRAYOW SENG SDN BHD*INV-1")).toBe("YOW SENG");
  });

  it("drops entity suffixes so punctuation variants converge", () => {
    expect(deriveHintPhrase("GET RENTAL SDN BHD")).toBe("GET RENTAL");
    expect(deriveHintPhrase("GET RENTAL SDN. BHD.")).toBe("GET RENTAL");
  });

  it("refuses generic or inter-company phrases", () => {
    expect(deriveHintPhrase("TRANSFER TO A/C 123456")).toBeNull();
    expect(deriveHintPhrase("TRANSFER FR A/C CELSIUS COFFEE SDN")).toBeNull();
  });
});
