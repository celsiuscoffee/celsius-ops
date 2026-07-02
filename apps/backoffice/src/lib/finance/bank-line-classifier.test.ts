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

  it("books CARD SALES debits as bank charges (terminal MDR), credits as CARD", () => {
    expect(dr("DR/CARD SALES M/N 2612988 D 5").category).toBe("BANK_FEE");
    expect(dr("CR/CARD SALES M/N 2612988 DATED 010626 D").category).toBe("BANK_FEE");
    expect(cr("DR/CARD SALES M/N 2612988 D 5").category).toBe("CARD");
  });

  it("maps utility providers + Pilihan Megah rent (per owner)", () => {
    expect(dr("TRANSFER FR A/C TIME DOTCOM BHD monthly bill").category).toBe("UTILITIES");
    expect(dr("PAYMENT TO TT DOTCOM SDN BHD").category).toBe("UTILITIES");
    expect(dr("CELSIUS COFFEE PUTRATIMEDOTCOM* JUN26").category).toBe("UTILITIES");
    expect(dr("TRANSFER FR A/C SOMEBODY water bill june").category).toBe("UTILITIES");
    expect(dr("TRANSFER FR A/C XYZ internet subscription").category).toBe("UTILITIES");
    expect(dr("TRANSFER FR A/C PILIHAN MEGAH SDN B rental jun").category).toBe("RENT");
    expect(dr("CELSIUS COFFEE TAMARPILIHAN MEGAH SDN*").category).toBe("RENT");
  });

  it("books WME standing-instruction debits as loan instalments (per owner)", () => {
    expect(dr("ESI PAYMENT DEBIT CELSIUS COFFEE SDN. WME000001 000046226300").category).toBe("LOAN");
    expect(dr("0000462263001821 CELSIUS COFFEE SDN.* WME000001").category).toBe("LOAN");
    expect(dr("0000462263002252 CELSIUS COFFEE SDN.* WME000002").category).toBe("LOAN");
  });

  it("classifies Grab daily payouts despite the glued merchant id", () => {
    expect(cr("202501036648 1575371GPAY NETWORK (M) SDN 202501036648 1").category).toBe("GRAB");
    expect(cr("NS0247629494 1583151GPAY NETWORK (M) SDN NS0247629494 1").category).toBe("GRAB");
  });

  it("books refunds, Ariff ad-hoc buys and marketing vendors (per owner)", () => {
    expect(cr("REFUND OVERPAYMENT COUNTRY BREAD BAKER* Fund transfer").category).toBe("REFUND");
    expect(cr("GIRO INWARD RETURN CREDIT M 26010961851229 IV2604-00133 04IN").category).toBe("REFUND");
    expect(cr("TRANSFER TO A/C ELITE PAC SDN. BHD. Overpay MBB CT-").category).toBe("REFUND");
    expect(dr("TRANSFER FR A/C ARIFF IZHAM BIN ABD 2026/0021 CelsiusCoffee").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C WEB IMPIAN SDN BHD invoice 123").category).toBe("OTHER_MARKETING");
    expect(dr("TRANSFER FR A/C ASIA SQUARE EVENTS booth").category).toBe("OTHER_MARKETING");
  });

  it("falls back to OTHER_* for genuinely unknown lines", () => {
    expect(dr("TRANSFER FR A/C SOME UNKNOWN VENDOR XYZ").category).toBe("OTHER_OUTFLOW");
    expect(cr("MISC CREDIT NO PATTERN").category).toBe("OTHER_INFLOW");
    expect(dr("TRANSFER FR A/C SOME UNKNOWN VENDOR XYZ").isInterCo).toBe(false);
  });

  it("sees through Maybank's glued 20-char sender prefix", () => {
    // Beneficiary field: "Celsius Coffee Putra" (exactly 20 chars) runs straight
    // into the payee, so \b-anchored supplier rules miss without the strip pass.
    expect(dr("CELSIUS COFFEE PUTRAYOW SENG SDN BHD*YSIV-2601").category).toBe("RAW_MATERIALS");
    expect(dr("CELSIUS COFFEE TAMARCOLLECTIVE PROJECT *IV-1234").category).toBe("RAW_MATERIALS");
    expect(dr("CELSIUS COFFEE PUTRATMM RESOURCES *1-260601").category).toBe("RAW_MATERIALS");
    expect(dr("CELSIUS COFFEE PUTRAJG PACIFIC FOODS SD* ").category).toBe("RAW_MATERIALS");
  });

  it("classifies purpose suffixes that run into references", () => {
    expect(dr("TRANSFER FR A/C ENCIK AZLAND ZULFIZ Q1 DIVIDENDQ1 2 MBB").category).toBe("DIVIDEND");
    expect(dr("TRANSFER FR A/C AAS TAXATION SDN. B TAX FORMC").category).toBe("TAX");
    expect(dr("CELSIUSCOFFEE SB ASSOCIATES * HALF AUDIT FEE").category).toBe("COMPLIANCE");
    expect(dr("ELECTRONIC REMITTANCE - GIR RENTOKIL INITIAL (M").category).toBe("MAINTENANCE");
  });

  it("classifies the newly named suppliers", () => {
    expect(dr("TRANSFER FR A/C JIJUS CAKES TO SHAR IV CELSIUS COFFEE PUTRA").category).toBe("RAW_MATERIALS");
    expect(dr("CELSIUS COFFEE SHAH BGS TRADING SDN. BH*KIV").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C THE MILK MINISTRY #1-14819").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C ELITE PAC SDN BHD IV-123").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C KUALA LUMPUR FRIED CELSIUS COFFEE PUTRA").category).toBe("RAW_MATERIALS");
  });

  it("classifies unknown payees via the supplier registry hints", () => {
    const hints = ["ACME BEANS ROASTERY"];
    const hit = classifyBankLine({ description: "CELSIUS COFFEE PUTRAACME BEANS ROASTERY*INV9", amount: 100, direction: "DR", vendorHints: hints });
    expect(hit.category).toBe("RAW_MATERIALS");
    expect(hit.ruleName).toBe("vendor_registry");
    // hints never override a real rule, and never apply to inflows
    expect(classifyBankLine({ description: "TRANSFER FR A/C TUJUAN GEMILANG rent", amount: 100, direction: "DR", vendorHints: ["TUJUAN GEMILANG"] }).category).toBe("RENT");
    expect(classifyBankLine({ description: "SOME ACME BEANS ROASTERY CREDIT", amount: 100, direction: "CR", vendorHints: hints }).category).toBe("OTHER_INFLOW");
  });
});
