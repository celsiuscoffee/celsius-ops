import { describe, it, expect } from "vitest";
import {
  detectDuplicateBills,
  detectOutOfBalance,
  detectMissingDocs,
  detectAmountOutliers,
  type BillRow,
  type TxnRow,
} from "./anomaly-detectors";

function bill(over: Partial<BillRow> & Pick<BillRow, "id">): BillRow {
  return {
    companyId: "co1",
    supplierId: "sup1",
    supplierName: "FarmFresh",
    billNumber: null,
    billDate: "2026-06-10",
    total: 100,
    sourceDocId: "doc1",
    ...over,
  };
}
function txn(over: Partial<TxnRow> & Pick<TxnRow, "id">): TxnRow {
  return { companyId: "co1", txnType: "ap_bill", status: "posted", sourceDocId: "doc1", sumDebit: 100, sumCredit: 100, ...over };
}

describe("detectDuplicateBills", () => {
  it("flags the second+ bill with the same supplier + bill number", () => {
    const f = detectDuplicateBills([
      bill({ id: "b1", billNumber: "INV-100" }),
      bill({ id: "b2", billNumber: "inv 100" }), // normalized-equal
      bill({ id: "b3", billNumber: "INV-200" }),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0].relatedId).toBe("b2");
    expect(f[0].proposed?.duplicateOf).toBe("b1");
  });

  it("ignores bills without a supplier or bill number", () => {
    expect(detectDuplicateBills([bill({ id: "b1", billNumber: null }), bill({ id: "b2", billNumber: null })])).toHaveLength(0);
    expect(detectDuplicateBills([bill({ id: "b1", supplierId: null, billNumber: "X" }), bill({ id: "b2", supplierId: null, billNumber: "X" })])).toHaveLength(0);
  });

  it("does not flag the same number across different suppliers", () => {
    expect(
      detectDuplicateBills([bill({ id: "b1", supplierId: "s1", billNumber: "1" }), bill({ id: "b2", supplierId: "s2", billNumber: "1" })])
    ).toHaveLength(0);
  });
});

describe("detectOutOfBalance", () => {
  it("flags a posted transaction whose debits ≠ credits", () => {
    const f = detectOutOfBalance([txn({ id: "t1", sumDebit: 100, sumCredit: 99 })]);
    expect(f).toHaveLength(1);
    expect(f[0].priority).toBe("urgent");
  });
  it("ignores balanced and non-posted transactions", () => {
    expect(detectOutOfBalance([txn({ id: "t1", sumDebit: 100, sumCredit: 100 })])).toHaveLength(0);
    expect(detectOutOfBalance([txn({ id: "t2", status: "draft", sumDebit: 100, sumCredit: 90 })])).toHaveLength(0);
  });
});

describe("detectMissingDocs", () => {
  it("flags a posted AR/AP transaction with no source doc", () => {
    const f = detectMissingDocs([txn({ id: "t1", txnType: "ar_invoice", sourceDocId: null })]);
    expect(f).toHaveLength(1);
    expect(f[0].type).toBe("missing_doc");
  });
  it("exempts manual journals and transactions that have a doc", () => {
    expect(detectMissingDocs([txn({ id: "t1", txnType: "journal", sourceDocId: null })])).toHaveLength(0);
    expect(detectMissingDocs([txn({ id: "t2", txnType: "ap_bill", sourceDocId: "doc9" })])).toHaveLength(0);
  });
});

describe("detectAmountOutliers", () => {
  const history = new Map<string, number[]>([["sup1", [100, 110, 95, 105, 100]]]); // median 100

  it("flags a bill far above the supplier's median (multiple AND absolute)", () => {
    const f = detectAmountOutliers([bill({ id: "b1", total: 900 })], history); // 9× and +800
    expect(f).toHaveLength(1);
    expect(f[0].type).toBe("anomaly");
    expect(f[0].proposed?.multiple).toBe(9);
  });

  it("does not flag a large multiple with a small absolute jump", () => {
    const cheap = new Map<string, number[]>([["sup1", [10, 11, 9, 10, 10]]]); // median 10
    expect(detectAmountOutliers([bill({ id: "b1", total: 45 })], cheap)).toHaveLength(0); // 4.5× but only +35
  });

  it("needs enough history before flagging", () => {
    const thin = new Map<string, number[]>([["sup1", [100, 100]]]);
    expect(detectAmountOutliers([bill({ id: "b1", total: 5000 })], thin)).toHaveLength(0);
  });

  it("does not flag a normal-sized bill", () => {
    expect(detectAmountOutliers([bill({ id: "b1", total: 120 })], history)).toHaveLength(0);
  });
});
