import { describe, it, expect } from "vitest";
import { classifyBankLine } from "./bank-line-classifier";

const cr = (description: string, amount = 100) =>
  classifyBankLine({ description, amount, direction: "CR" });
const dr = (description: string, amount = 100) =>
  classifyBankLine({ description, amount, direction: "DR" });

describe("bank-line-classifier", () => {
  it("books the director's ad reimbursements as DIGITAL_ADS whatever the spelling", () => {
    // Real Jul/Aug-2026 narrations. None contain "ads claim", so the older rule
    // dropped them into OTHER_OUTFLOW — RM18,575 in August alone.
    expect(dr("Shah Alam AMMAR BIN SHAHRIN * Marketing 0726").category).toBe("DIGITAL_ADS");
    expect(dr("Tamarind AMMAR BIN SHAHRIN * Marketing 0626").category).toBe("DIGITAL_ADS");
    expect(dr("Shah Alam AMMAR BIN SHAHRIN * indeed 15/8/26").category).toBe("DIGITAL_ADS");
    expect(dr("Putrajaya AMMAR BIN SHAHRIN * Ads Clam Jun26").category).toBe("DIGITAL_ADS");
    // Older spellings keep working
    expect(dr("Celsius Coffee PutraAMMAR BIN SHAHRIN * Ads claim May").category).toBe("DIGITAL_ADS");
    // A genuine director drawing is NOT an ad claim
    expect(dr("TRANSFER FR A/C AMMAR BIN SHAHRIN ADTD").category).toBe("DIRECTORS_ALLOWANCE");
    // Suppliers with "Marketing" in their NAME must stay out of DIGITAL_ADS —
    // this is why the rule is scoped to the director instead of sweeping the word.
    expect(dr("PUTRAJAYA BEST MARKETING & DI* IY-741245").category).not.toBe("DIGITAL_ADS");
    expect(dr("Shah Alam PXL MARKETING SDN BHD* INV-2231").category).not.toBe("DIGITAL_ADS");
  });

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

  it("flags the new Maybank format (no A/C marker) when the Celsius payee ≠ the account", () => {
    // Mid-2026 format: outlets fund the central SA payroll/statutory run by
    // transferring into "CELSIUS COFFEE SDN.*". On a Conezion/Tamarind
    // statement that payee is a DIFFERENT entity → inter-company.
    const on = (description: string, accountKey: string) =>
      classifyBankLine({ description, amount: 100, direction: "DR", accountKey });
    const conez = "CELSIUS COFFEE CONEZION SDN. BHD. (2644)";
    const tama = "CELSIUS COFFEE TAMARIND SDN. BHD. (9345)";
    expect(on("Celsius Coffee ConezCELSIUS COFFEE SDN.* Salary May26", conez).isInterCo).toBe(true);
    expect(on("CELSIUS COFFEE SDN.* Salary 1/1", conez).isInterCo).toBe(true);
    expect(on("CelsiusCoffee C CELSIUS COFFEE SDN.* Stat pay", conez).isInterCo).toBe(true);
    expect(on("Tamarind CELSIUS COFFEE SDN.* Stat Pay Jun26", tama).isInterCo).toBe(true);
    expect(on("Celsius Coffee TamarCELSIUS COFFEE SDN.* Salary May 1", tama).isInterCo).toBe(true);
    // category still attributed for the P&L
    expect(on("CELSIUS COFFEE SDN.* Salary 1/1", conez).category).toBe("EMPLOYEE_SALARY");
  });

  it("does NOT flag the same Celsius token when it IS the account holder (SA's own loan/fee debits)", () => {
    // On the SA statement, "CELSIUS COFFEE SDN.*" is the account holder, not a
    // counterparty — the WME loan instalments must stay external, not inter-co.
    const sa = "CELSIUS COFFEE SDN. BHD. (4384)";
    const on = (description: string) =>
      classifyBankLine({ description, amount: 100, direction: "DR", accountKey: sa });
    expect(on("0000462263001821 CELSIUS COFFEE SDN.* WME000001").isInterCo).toBe(false);
    expect(on("0000462263002252 CELSIUS COFFEE SDN.* WME000002").isInterCo).toBe(false);
    expect(on("0000462263001821 CELSIUS COFFEE SDN.* WME000001").category).toBe("LOAN");
    // A glued-sender supplier payment on a Celsius account is not inter-co either
    expect(on("CELSIUS COFFEE PUTRAYOW SENG SDN BHD*YSIV-2601").isInterCo).toBe(false);
    expect(classifyBankLine({ description: "Celsius Coffee TamarCOLLECTIVE PROJECT *IV-1234", amount: 100, direction: "DR", accountKey: "CELSIUS COFFEE TAMARIND SDN. BHD. (9345)" }).isInterCo).toBe(false);
  });

  it("reads the abbreviated Aug-2026 payroll narration as salary, not OTHER_OUTFLOW", () => {
    // Maybank switched "Salary Jun26" -> "Sal Jul26" and added "Add OT Jul26".
    // The old /\bSALARY\b/ rule missed every one of them and the whole Jul-26
    // payroll landed in fallback_other.
    expect(dr("Conezion FIRDAUS BIN NAJIB * Sal Jul26").category).toBe("EMPLOYEE_SALARY");
    expect(dr("CELSIUS COFFEE HQ ADAM KELVIN * SAL JUL26").category).toBe("EMPLOYEE_SALARY");
    expect(dr("Putrajaya CELSIUS COFFEE SDN.* Sal Jul26 2/2").category).toBe("EMPLOYEE_SALARY");
    expect(dr("Conejion AHMAD RAZLEY HIDAYA* Add OT Jul26").category).toBe("EMPLOYEE_SALARY");
    expect(dr("SHAH ALAM SHAIRULEEN BINTI JE* ADD OT JUL26").category).toBe("EMPLOYEE_SALARY");
    expect(dr("Tamarind CELSIUS COFFEE SDN.* OT Jul26").category).toBe("EMPLOYEE_SALARY");
    // Ariff's pay line must beat raw_ariff_adhoc, which grabbed it as RAW_MATERIALS
    expect(dr("Celsius Coffee HQ ARIFF IZHAM BIN ABD* Sal Jul26").category).toBe("EMPLOYEE_SALARY");
    // the older spellings keep working
    expect(dr("Celsius Coffee HQ ARIFF IZHAM BIN ABD* Salary Jun26").category).toBe("EMPLOYEE_SALARY");
    expect(dr("CELSIUS COFFEE SDN.* Salary 1/1").category).toBe("EMPLOYEE_SALARY");
    // and the CR twin (outlet funding the central run) stays inter-co
    expect(cr("CELSIUS COFFEE CONE* Sal Jul26 1/2").category).toBe("EMPLOYEE_SALARY");
    expect(cr("CELSIUS COFFEE CONE* Sal Jul26 1/2").isInterCo).toBe(true);
  });

  it("reads the abbreviated management-fee narration", () => {
    // "Mngmt Fee" -> "Mgmt Fee 1/2" / bare "mgmt 1/4"
    expect(dr("Tamarind CELSIUS COFFEE SDN.* Mgmt Fee 1/2").category).toBe("MANAGEMENT_FEE");
    expect(dr("Tamarind CELSIUS COFFEE SDN.* Mgmt fee 2/2").category).toBe("MANAGEMENT_FEE");
    expect(dr("Putrajaya CELSIUS COFFEE SDN.* mgmt 1/4").category).toBe("MANAGEMENT_FEE");
    expect(dr("TRANSFER FR A/C CELSIUS COFFEE SDN. Mngmt Fee").category).toBe("MANAGEMENT_FEE");
  });

  it("does not read SAL/OT as payroll without a pay period after them", () => {
    // the short forms are anchored on "Jul26" / "1/2" so they cannot swallow
    // unrelated vendor lines or references
    expect(dr("TRANSFER FR A/C SAL SUPPLIES SDN BHD INV-9").category).not.toBe("EMPLOYEE_SALARY");
    expect(dr("SHAH ALAM MUHAMAD SYAFIQ AIMA* L0131401202300").category).not.toBe("EMPLOYEE_SALARY");
    expect(dr("TRANSFER FR A/C PARKING LOT 12/34 rental").category).not.toBe("EMPLOYEE_SALARY");
  });

  it("classifies the reclassified OTHER_OUTFLOW vendors", () => {
    expect(dr("TRANSFER FR A/C COUNTRY BREAD BAKER INV-001").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C BEARD BROTHERS MEAT INV250").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C UNIQUE PAPER SDN. B INU-25").category).toBe("RAW_MATERIALS");
    expect(dr("TRANSFER FR A/C BESPOKE INTERIOR SD INV011").category).toBe("INVESTMENTS");
    expect(dr("TRANSFER FR A/C KIAN CONTRACT SDN B Furniture").category).toBe("EQUIPMENTS");
    expect(dr("TRANSFER FR A/C NURFARAH QURAISYA B SCC Week 36").category).toBe("EMPLOYEE_SALARY");
  });

  it("tags part-timer weekly transfers with the outlet from the venue prefix", () => {
    // June-2026 bank format: venue name prefixes the payee. These four venues
    // previously fell through inferOutlet, leaving PT wages unattributed.
    const sa = dr("Seksyen 13 Shah AlamENGKU EMRAN DZULKAR* PT Week 23/26");
    expect(sa.category).toBe("PARTIMER");
    expect(sa.outletCode).toBe("CC002");
    const nilai = dr("Gastrohub Nilai AIMI NADHIRA BINTI * PT Week 23/26");
    expect(nilai.category).toBe("PARTIMER");
    expect(nilai.outletCode).toBe("CF Nilai");
    const ioi = dr("IOI MALL PUTRAJAYA MOHAMA* PT WEEK 23/26");
    expect(ioi.category).toBe("PARTIMER");
    expect(ioi.outletCode).toBe("CF IOI Mall");
    // Existing prefixes keep working
    expect(dr("TAMARIND SQUARE CHE QASEH QAZRINA B* PT WEEK 23/26").outletCode).toBe("CC003");
    expect(dr("Conezion Putrajaya NURHAN DANIAL BIN S* PT Week 23/26").outletCode).toBe("CC001");
  });

  it("catches the abbreviated PT week narration that started 2026-08-21", () => {
    // Maybank dropped "Week" mid-August; these four lines (RM882) fell into
    // OTHER_OUTFLOW and understated August part-timer wages.
    expect(dr("Shah Alam FARAH NABILAH BINTI* Pt W33 26").category).toBe("PARTIMER");
    expect(dr("Shah Alam MOHAMED DANISH HYQA* Pt w33 26").category).toBe("PARTIMER");
    expect(dr("Tamarind MUHAMAD FARHAN IKHM* PT W33/26").category).toBe("PARTIMER");
    expect(dr("Conezion MUHAMAD FARHAN IKHM* PT W33/26").outletCode).toBe("CC001");
    // Older spellings keep working
    expect(dr("Tamarind Square MUHAMMAD ADIB BIN Z* PT Week 33/26").category).toBe("PARTIMER");
    expect(dr("SHAH ALAM AIMI NADHIRA BINTI* PARTIMER JUL").category).toBe("PARTIMER");
    // A bare "PT" with no week number must not swallow unrelated lines
    expect(dr("Shah Alam PT SUMBER REZEKI* INV-88213").category).not.toBe("PARTIMER");
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
    // Maybank truncates the reference mid-word: "Q1 2026 Divide" is a
    // shareholder dividend (owner confirmed), and a dividend to a name that is
    // ALSO a supplier stays a dividend (Mikofee went to RAW_MATERIALS once).
    expect(dr("TRANSFER FR A/C BADRUL AZMI BIN JAM Q1 2026 Divide").category).toBe("DIVIDEND");
    expect(dr("TRANSFER FR A/C MIKOFEE SDN. BHD. Q4 2025 Dividend MBB CT").category).toBe("DIVIDEND");
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

describe("learned category hints", () => {
  const hints = [{ phrase: "GET RENTAL", category: "EQUIPMENTS" as const, direction: "DR" as const }];

  it("outranks generic keyword rules — a corrected payee never regresses", () => {
    // \bRENTAL\b alone would read this as RENT; the learned correction wins.
    const res = classifyBankLine({ description: "I2606-0155 GET RENTAL SDN. BHD* I2606-0155", amount: 399, direction: "DR", learnedHints: hints });
    expect(res.category).toBe("EQUIPMENTS");
    expect(res.ruleName).toBe("learned_hint");
  });

  it("sees through the glued 20-char sender prefix", () => {
    expect(classifyBankLine({ description: "CELSIUS COFFEE PUTRAGET RENTAL SDN. BHD*X", amount: 399, direction: "DR", learnedHints: hints }).category).toBe("EQUIPMENTS");
  });

  it("respects the hint direction and falls through otherwise", () => {
    expect(classifyBankLine({ description: "GET RENTAL SDN BHD REFUND", amount: 399, direction: "CR", learnedHints: hints }).category).toBe("REFUND");
  });
});
