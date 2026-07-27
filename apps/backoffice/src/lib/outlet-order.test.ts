import { describe, it, expect } from "vitest";
import { sortOutlets } from "./outlet-order";

describe("sortOutlets (canonical business order)", () => {
  it("orders Putrajaya, Shah Alam, Tamarind, Nilai, IOI regardless of alphabet", () => {
    const alphabetical = [
      { id: "5", name: "Celsius Coffee IOI Mall" },
      { id: "4", name: "Celsius Coffee Nilai" },
      { id: "1", name: "Celsius Coffee Putrajaya" },
      { id: "2", name: "Celsius Coffee Shah Alam" },
      { id: "3", name: "Celsius Coffee Tamarind" },
    ];
    expect(sortOutlets(alphabetical).map((o) => o.id)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("matches on code when the name doesn't carry the location", () => {
    const byCode = [
      { id: "b", code: "CC002", name: "Outlet Two" },
      { id: "a", code: "CC001", name: "Outlet One" },
      { id: "c", code: "CC003", name: "Outlet Three" },
    ];
    expect(sortOutlets(byCode).map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("puts unknown outlets after the known five, alphabetically", () => {
    const mixed = [
      { id: "x", name: "Celsius HQ Warehouse" },
      { id: "1", name: "Celsius Coffee Putrajaya" },
      { id: "y", name: "Celsius Airport Kiosk" },
    ];
    expect(sortOutlets(mixed).map((o) => o.id)).toEqual(["1", "y", "x"]);
  });

  it("recognises the Conezion alias for Putrajaya", () => {
    const rows = [
      { id: "sa", name: "Shah Alam" },
      { id: "pj", name: "Conezion" },
    ];
    expect(sortOutlets(rows).map((o) => o.id)).toEqual(["pj", "sa"]);
  });
});
