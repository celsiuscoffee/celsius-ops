import { describe, it, expect } from "vitest";
import { normalizeInvoiceNumber, stripReclaimSuffix } from "./invoice-dedupe";

describe("normalizeInvoiceNumber", () => {
  it("drops punctuation and case so re-keyed numbers collide", () => {
    expect(normalizeInvoiceNumber("26-0644")).toBe("260644");
    expect(normalizeInvoiceNumber("260644")).toBe("260644");
    expect(normalizeInvoiceNumber("A-9O6LEVCWWCFRAV")).toBe("a9o6levcwwcfrav");
    expect(normalizeInvoiceNumber("INV 006545 / 006577")).toBe("inv006545006577");
  });
  it("is empty for missing numbers", () => {
    expect(normalizeInvoiceNumber(null)).toBe("");
    expect(normalizeInvoiceNumber("")).toBe("");
  });
});

describe("stripReclaimSuffix", () => {
  it("strips a single trailing letter after a digit (re-claim variants)", () => {
    expect(stripReclaimSuffix("12427a")).toBe("12427");
    expect(stripReclaimSuffix("731175a")).toBe("731175");
    expect(stripReclaimSuffix("a9a6pwengwf9oav1")).toBeNull(); // ends in a digit
  });
  it("leaves genuine alphanumeric codes alone", () => {
    expect(stripReclaimSuffix("12427")).toBeNull();
    expect(stripReclaimSuffix("ivct00012381")).toBeNull();
    expect(stripReclaimSuffix("a9axh9vjgw9brav")).toBeNull(); // letter after letter, not digit
  });
});
