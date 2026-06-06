import { describe, it, expect } from "vitest";
import { parseMaybankStatementText } from "./maybank-statement-parser";

// Mimics `pdftotext -layout` output: repeated page chrome, a transaction whose
// description continues AFTER a page break, trailing +/- sign convention.
const STATEMENT = `
                    Maybank Islamic Berhad (787435-M)
       IBS BANDAR BARU BANGI
                              STATEMENT DATE  :  31/05/26
       CELSIUS COFFEE SDN. BHD.
       NO. 12-1, JALAN PPS 2
                              ACCOUNT NUMBER  :  562263574384
 ENTRY DATE   VALUE DATE      TRANSACTION DESCRIPTION      TRANSACTION AMOUNT      STATEMENT BALANCE
                    BEGINNING BALANCE                                                  1,000.00
       01/05         TRANSFER FR A/C                              100.00-               900.00
                       SUPPLIER A *
                       INV-001
       02/05         TRANSFER TO A/C                              250.50+             1,150.50
                       CUSTOMER QR *
 BAKI LEGAR          LEDGER BALANCE
                    Maybank Islamic Berhad (787435-M)
       IBS BANDAR BARU BANGI
       CELSIUS COFFEE SDN. BHD.
 ENTRY DATE   VALUE DATE      TRANSACTION DESCRIPTION      TRANSACTION AMOUNT      STATEMENT BALANCE
                       DUITNOW QR-
       03/05         CMS - CR PYMT MARS                            49.50+             1,200.00
 BAKI LEGAR          LEDGER BALANCE
`;

describe("parseMaybankStatementText", () => {
  const r = parseMaybankStatementText(STATEMENT);

  it("extracts header fields", () => {
    expect(r.accountNumber).toBe("562263574384");
    expect(r.statementDate).toBe("2026-05-31");
    expect(r.accountName).toBe("CELSIUS COFFEE SDN. BHD.");
  });

  it("parses every transaction with the trailing sign as the source of truth", () => {
    expect(r.rowsParsed).toBe(3);
    expect(r.lines[0]).toMatchObject({ txnDate: "2026-05-01", direction: "DR", amount: 100.0 });
    expect(r.lines[1]).toMatchObject({ txnDate: "2026-05-02", direction: "CR", amount: 250.5 });
    expect(r.lines[2]).toMatchObject({ txnDate: "2026-05-03", direction: "CR", amount: 49.5 });
  });

  it("stitches a description that continues across a page break", () => {
    expect(r.lines[1].description).toBe("TRANSFER TO A/C CUSTOMER QR DUITNOW QR-");
  });

  it("computes balances and totals and reconciles against the running-balance column", () => {
    expect(r.beginningBalance).toBe(1000.0);
    expect(r.endingBalance).toBe(1200.0);
    expect(r.totalInflows).toBe(300.0);
    expect(r.totalOutflows).toBe(100.0);
    expect(r.periodStart).toBe("2026-05-01");
    expect(r.periodEnd).toBe("2026-05-03");
    expect(r.reconciled).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });
});

describe("balance-walk integrity check", () => {
  it("flags a tampered running balance even when totals still tie out", () => {
    // Corrupt only line 1's balance (900.00 -> 950.00). Amounts/totals are
    // unaffected, so beginning+Σ still equals ending — but the per-line walk
    // must catch the drift.
    const tampered = STATEMENT.replace("100.00-               900.00", "100.00-               950.00");
    const r = parseMaybankStatementText(tampered);
    expect(r.reconciled).toBe(false);
    expect(r.warnings.some((w) => /Balance walk mismatch/.test(w))).toBe(true);
  });
});

describe("real-statement edge cases (regression guards)", () => {
  it("reads overdrawn balances marked with a trailing DR as negative", () => {
    const s = `
       Maybank Islamic Berhad (787435-M)
                              STATEMENT DATE  :  30/04/26
       CELSIUS COFFEE SDN. BHD.
                              ACCOUNT NUMBER  :  562263574384
 ENTRY DATE   VALUE DATE      TRANSACTION DESCRIPTION      TRANSACTION AMOUNT      STATEMENT BALANCE
                    BEGINNING BALANCE                                                    100.00
       10/04         TRANSFER FR A/C                              150.00-                 50.00DR
       10/04         TRANSFER TO A/C                               80.00+                 30.00
 BAKI LEGAR          LEDGER BALANCE
`;
    const r = parseMaybankStatementText(s);
    expect(r.lines[0].balance).toBe(-50.0);
    expect(r.endingBalance).toBe(30.0);
    expect(r.totalOutflows).toBe(150.0);
    expect(r.reconciled).toBe(true);
  });

  it("reads sub-RM1 amounts written without a leading zero (.95)", () => {
    const s = `
       Maybank Islamic Berhad (787435-M)
                              STATEMENT DATE  :  31/05/26
       CELSIUS COFFEE SDN. BHD.
                              ACCOUNT NUMBER  :  562263659345
 ENTRY DATE   VALUE DATE      TRANSACTION DESCRIPTION      TRANSACTION AMOUNT      STATEMENT BALANCE
                    BEGINNING BALANCE                                                     10.00
       04/05         DR/CARD SALES M/N 1 D 5                         .95-                  9.05
       05/05         DR/CARD SALES M/N 1 D 5                        1.50+                 10.55
 BAKI LEGAR          LEDGER BALANCE
`;
    const r = parseMaybankStatementText(s);
    expect(r.lines[0].amount).toBe(0.95);
    expect(r.lines[0].direction).toBe("DR");
    expect(r.reconciled).toBe(true);
  });
});

describe("year resolution across the Dec->Jan boundary", () => {
  it("assigns the prior calendar year to a December txn on a January statement", () => {
    const s = `
       Maybank Islamic Berhad (787435-M)
                              STATEMENT DATE  :  31/01/26
       CELSIUS COFFEE TAMARIND SDN. BHD.
                              ACCOUNT NUMBER  :  562263659345
 ENTRY DATE   VALUE DATE      TRANSACTION DESCRIPTION      TRANSACTION AMOUNT      STATEMENT BALANCE
                    BEGINNING BALANCE                                                    500.00
       31/12         TRANSFER FR A/C                               10.00-               490.00
       02/01         TRANSFER TO A/C                               20.00+               510.00
 BAKI LEGAR          LEDGER BALANCE
`;
    const r = parseMaybankStatementText(s);
    expect(r.lines[0].txnDate).toBe("2025-12-31");
    expect(r.lines[1].txnDate).toBe("2026-01-02");
    expect(r.reconciled).toBe(true);
  });
});
