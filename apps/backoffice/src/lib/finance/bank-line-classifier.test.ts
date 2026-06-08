import { describe, it, expect } from "vitest";
import { classifyBankLine } from "./bank-line-classifier";

const cr = (description: string, amount = 100) =>
  classifyBankLine({ description, amount, direction: "CR" });
const dr = (description: string, amount = 100) =>
  classifyBankLine({ description, amount, direction: "DR" });

describe("bank-line-classifier", () => {
  it("maps sales inflows to their channel", () => {
    expect(cr("TRANSFER TO A/C JOHN DOE DUITNOW QR-").category).toBe("QR");
    expect(cr("DR/CARD SALES M/N 2612988 D 5").category).toBe("CARD");
    expect(cr("IBG GPAY NETWORK SDN BHD").category).toBe("GRAB");
    expect(cr("TRANSFER FR A/C GYRO GASTRO SDN. BH vendor").category).toBe("GASTROHUB");
    expect(cr("INTERBANK GIRO STOREHUB SDN BHD").category).toBe("STOREHUB");
  });

  it("flags ANY inter-entity transfer as inter-company, regardless of purpose", () => {
    expect(dr("TRANSFER TO A/C CELSIUS COFFEE TAMA Loan").isInterCo).toBe(true);
    expect(cr("TRANSFER FR A/C CELSIUS COFFEE SDN. Payback loan").isInterCo).toBe(true);
    expect(dr("TRANSFER FR A/C CELSIUS COFFEE CONEZION Inventory").isInterCo).toBe(true);
    // purpose category is still set even though it's inter-co
    expect(dr("TRANSFER FR A/C CELSIUS COFFEE SDN. Digital Ads").category).toBe("DIGITAL_ADS");
  });

  it("does NOT flag a line that only mentions Celsius outside the counterparty slot", () => {
    // account-holder / reference mention, not a transfer TO/FR a Celsius A/C
    expect(dr("ESI PAYMENT DEBIT CELSIUS COFFEE SDN. WME00000").isInterCo).toBe(false);
    expect(dr("TRANSFER FR A/C 365EAT FOOD SDN BHD INV CELSIUS").isInterCo).toBe(false);
  });

  it("classifies the reclassified OTHER_OUTFLOW vendors", () => {
    expect(dr("TRANSFER FR A/C COUNTRY BREAD BAKER INV-001").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C BEARD BROTHERS MEAT INV250").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C UNIQUE PAPER SDN. B INU-25").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C BESPOKE INTERIOR SD INV011").category).toBe("INVESTMENTS");
    expect(dr("TRANSFER FR A/C KIAN CONTRACT SDN B Furniture").category).toBe("EQUIPMENTS");
    expect(dr("TRANSFER FR A/C NURFARAH QURAISYA B SCC Week 36").category).toBe("EMPLOYEE_SALARY");
  });

  it("maps statutory + known opex vendors", () => {
    expect(dr("M2UBEPF KWSP PAYMENT").category).toBe("STATUTORY_PAYMENT");
    expect(dr("PAYMENT TO TNB TENAGA NASIONAL").category).toBe("UTILITIES");
    expect(dr("TRANSFER FR A/C TUJUAN GEMILANG rent").category).toBe("RENT");
  });

  it("falls back to OTHER_* for genuinely unknown lines", () => {
    expect(dr("TRANSFER FR A/C SOME UNKNOWN VENDOR XYZ").category).toBe("OTHER_OUTFLOW");
    expect(cr("MISC CREDIT NO PATTERN").category).toBe("OTHER_INFLOW");
    expect(dr("TRANSFER FR A/C SOME UNKNOWN VENDOR XYZ").isInterCo).toBe(false);
  });
});
