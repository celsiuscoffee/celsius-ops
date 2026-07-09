import { describe, it, expect } from "vitest";
import { digitRuns, invoiceRefInDesc, subsetSumIdx, aliasPhrasesFor, aliasInDesc, invoiceSig, descNamesForeignInvoice } from "./ap-match-lib";

describe("ap-match-lib", () => {
  it("extracts digit runs from bank descriptions", () => {
    expect(digitRuns("celsius coffee putracountry bread baker* inv-006545, 006577")).toEqual(["6545", "6577"]);
    expect(digitRuns("yow seng sdn bhd*ysiv-0801")).toEqual(["801"]);
    expect(digitRuns("no digits here")).toEqual([]);
  });

  it("matches invoice numbers against description digit runs", () => {
    const runs = digitRuns("inv 006545, 006577, 006556, 006593");
    expect(invoiceRefInDesc("INV-006545", runs)).toBe(true);
    expect(invoiceRefInDesc("006593", runs)).toBe(true);
    expect(invoiceRefInDesc("INV-999999", runs)).toBe(false);
    // short/absent numbers never confirm
    expect(invoiceRefInDesc("12", runs)).toBe(false);
    expect(invoiceRefInDesc(null, runs)).toBe(false);
  });

  it("finds the invoice subset summing to a combined payment", () => {
    // Country Bread case: one transfer paying 4 invoices
    const cents = [70425, 55010, 88450, 46800, 120000];
    const target = 70425 + 55010 + 46800;
    const idx = subsetSumIdx(cents, target);
    expect(idx).not.toBeNull();
    expect(idx!.map((i) => cents[i]).reduce((a, b) => a + b, 0)).toBe(target);
  });

  it("never returns a single-invoice subset and handles no-solution", () => {
    expect(subsetSumIdx([50000, 30000], 50000)).toBeNull(); // size-1 is the single-match pass's job
    expect(subsetSumIdx([100, 200, 300], 999)).toBeNull();
  });

  it("tolerates 1-2 sen rounding drift", () => {
    const idx = subsetSumIdx([10001, 20001], 30000);
    expect(idx).not.toBeNull();
  });

  it("flags a bank line that names a DIFFERENT known invoice (the fixed-amount mis-match guard)", () => {
    // Every TMM order bills the same amount; the bank line quotes 1-15150 but we
    // are scoring it against 1-15288 → foreign ref, must not auto-settle.
    const sigs = new Set([invoiceSig("1-15150"), invoiceSig("1-15288"), invoiceSig("IVCT-00012166")]);
    expect(descNamesForeignInvoice("celsius coffee tamartmm resources * 1-15150", sigs, "1-15288")).toBe(true);
    // The line that names THIS invoice is confirmation, not foreign.
    expect(descNamesForeignInvoice("celsius coffee tamartmm resources * 1-15288", sigs, "1-15288")).toBe(false);
    // Milk n Moka: bank names IVCT-00012166, scoring against IVCT-00012222 → foreign.
    const mm = new Set([invoiceSig("IVCT-00012166"), invoiceSig("IVCT-00012222")]);
    expect(descNamesForeignInvoice("milk & moka marketi* ivct-00012166", mm, "IVCT-00012222")).toBe(true);
    // No invoice number in the narration → payee+amount is the only signal, not foreign.
    expect(descNamesForeignInvoice("transfer to milk & moka marketing", mm, "IVCT-00012222")).toBe(false);
    // A digit run that matches no known invoice (a date/amount) → not foreign.
    expect(descNamesForeignInvoice("payment 2026 rm432", mm, "IVCT-00012222")).toBe(false);
  });

  it("bridges payee aliases: TMM = The Milk Ministry, Ad-hoc Purchase = Ariff Izham", () => {
    // Invoice says The Milk Ministry; bank transfer says TMM (Resources)
    const milk = aliasPhrasesFor(["The Milk Ministry", null, null]);
    expect(aliasInDesc(milk, "celsius coffee putratmm resources *1-260601")).toBe(true);
    // Bank says Milk Ministry; supplier record says TMM Resources
    const tmm = aliasPhrasesFor(["TMM Resources", null, null]);
    expect(aliasInDesc(tmm, "transfer fr a/c the milk ministry #1-14819")).toBe(true);
    // Ad-hoc purchases are reimbursed to Ariff Izham
    const adhoc = aliasPhrasesFor([null, "Ad-hoc Purchase", null]);
    expect(aliasInDesc(adhoc, "transfer fr a/c ariff izham bin abd 2026/0021 celsiuscoffee")).toBe(true);
    // No alias, no hit
    expect(aliasPhrasesFor(["Yow Seng Sdn Bhd"])).toEqual([]);
    expect(aliasInDesc(adhoc, "transfer fr a/c somebody else entirely")).toBe(false);
  });
});
