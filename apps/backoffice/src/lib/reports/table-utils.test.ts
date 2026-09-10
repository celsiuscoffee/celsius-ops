import { describe, it, expect } from "vitest";
import { compareValues, sortRows, matchesQuery, csvCell, toCsv, facetValues } from "./table-utils";

describe("compareValues", () => {
  it("sorts numbers and strings, honouring direction", () => {
    expect(compareValues(1, 2, "asc")).toBeLessThan(0);
    expect(compareValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareValues("Apple", "Banana", "asc")).toBeLessThan(0);
  });
  it("orders embedded numbers naturally", () => {
    expect(compareValues("Item 9", "Item 10", "asc")).toBeLessThan(0);
  });
  it("keeps blanks at the bottom in BOTH directions", () => {
    expect(compareValues(null, 5, "asc")).toBeGreaterThan(0);
    expect(compareValues(null, 5, "desc")).toBeGreaterThan(0);
    expect(compareValues(5, "", "desc")).toBeLessThan(0);
    expect(compareValues(null, undefined, "asc")).toBe(0);
  });
});

describe("sortRows", () => {
  const rows = [
    { n: "a", v: 2 }, { n: "b", v: 1 }, { n: "c", v: 2 }, { n: "d", v: null as number | null },
  ];
  it("is stable for equal keys and puts blanks last", () => {
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.n)).toEqual(["a", "c", "b", "d"]);
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.n)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("matchesQuery", () => {
  it("requires every term, in any order", () => {
    expect(matchesQuery("Fresh Milk Shah Alam", "milk shah")).toBe(true);
    expect(matchesQuery("Fresh Milk Shah Alam", "shah milk")).toBe(true);
    expect(matchesQuery("Fresh Milk Shah Alam", "milk tamarind")).toBe(false);
  });
  it("matches everything when empty", () => {
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("csv", () => {
  it("quotes only what needs quoting", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("builds a header + rows document", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"], [2, null]])).toBe('a,b\r\n1,"x,y"\r\n2,');
  });
});

describe("facetValues", () => {
  it("returns sorted distinct non-blank values", () => {
    const rows = [{ c: "Dairy" }, { c: null }, { c: "Bread" }, { c: "Dairy" }, { c: "" }];
    expect(facetValues(rows, (r) => r.c)).toEqual(["Bread", "Dairy"]);
  });
});
