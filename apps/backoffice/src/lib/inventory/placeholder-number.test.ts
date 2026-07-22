import { describe, expect, it } from "vitest";
import {
  isPlaceholderNumber,
  normalizeInvoiceRef,
  numberShape,
  numberShapeMatchesHistory,
} from "./placeholder-number";

describe("isPlaceholderNumber", () => {
  it("recognises legacy and namespaced placeholders", () => {
    expect(isPlaceholderNumber("INV-1844")).toBe(true);
    expect(isPlaceholderNumber("TRF-0012")).toBe(true);
    expect(isPlaceholderNumber("GRNI-0071")).toBe(true);
    expect(isPlaceholderNumber("GRNI-CC001-0071")).toBe(true);
  });

  it("does not flag real supplier numbers", () => {
    expect(isPlaceholderNumber("IVCT-00012381")).toBe(false); // 8 digits — beyond placeholder range
    expect(isPlaceholderNumber("1-15415")).toBe(false);
    expect(isPlaceholderNumber("365IN2606-0138")).toBe(false);
    expect(isPlaceholderNumber("SO-00658")).toBe(false); // JS Breadserie's real numbering, not ours
    expect(isPlaceholderNumber(null)).toBe(false);
    expect(isPlaceholderNumber("")).toBe(false);
  });
});

describe("numberShape / numberShapeMatchesHistory", () => {
  it("reduces numbers to their shape", () => {
    expect(numberShape("IVCT-00012381")).toBe("ivct-#");
    expect(numberShape("1-15415")).toBe("#-#");
    expect(numberShape("365IN2606-0138")).toBe("#in#-#");
  });

  it("flags the real TMM contamination case (IVCT number on a 1-15xxx supplier)", () => {
    const tmmHistory = ["1-15415", "1-15386", "1-15366", "1-15288"];
    expect(numberShapeMatchesHistory("IVCT-00012381", tmmHistory)).toBe(false);
    expect(numberShapeMatchesHistory("1-15441", tmmHistory)).toBe(true);
  });

  it("passes anything when history is too thin to establish a pattern", () => {
    expect(numberShapeMatchesHistory("IVCT-00012381", ["1-15415"])).toBe(true);
    expect(numberShapeMatchesHistory("XYZ-1", [])).toBe(true);
  });

  it("ignores placeholder rows when learning the supplier's shape", () => {
    // Supplier history dominated by GRNI/INV placeholders must not teach
    // the checker that placeholders are the supplier's real format.
    const history = ["GRNI-0071", "INV-1946", "INV-1990", "26-0644", "26-0675", "26-0676"];
    expect(numberShapeMatchesHistory("26-0677", history)).toBe(true);
    expect(numberShapeMatchesHistory("IVCT-00012381", history)).toBe(false);
  });
});

describe("normalizeInvoiceRef", () => {
  it("folds separators and case so receipt/stored variants match", () => {
    // The real Blancoz case: receipt quoted "26 0677" (space) for our "26-0677".
    expect(normalizeInvoiceRef("26 0677")).toBe(normalizeInvoiceRef("26-0677"));
    expect(normalizeInvoiceRef("26 0677")).toBe("260677");
    // Slashes, mixed case, stray punctuation all fold away.
    expect(normalizeInvoiceRef("IVCT/00012381")).toBe(normalizeInvoiceRef("ivct-00012381"));
    expect(normalizeInvoiceRef("365IN2606-0138")).toBe("365in26060138");
  });

  it("does not collapse genuinely different numbers together", () => {
    expect(normalizeInvoiceRef("26-0677")).not.toBe(normalizeInvoiceRef("26-0678"));
    // A shorter number must not equal a longer one that merely ends with it —
    // exact-equality callers rely on this ("260677" ≠ "1260677").
    expect(normalizeInvoiceRef("1-260677")).not.toBe(normalizeInvoiceRef("26-0677"));
  });

  it("handles null / empty safely", () => {
    expect(normalizeInvoiceRef(null)).toBe("");
    expect(normalizeInvoiceRef(undefined)).toBe("");
    expect(normalizeInvoiceRef("")).toBe("");
  });
});
