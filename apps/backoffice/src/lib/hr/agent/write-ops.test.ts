import { describe, it, expect } from "vitest";
import { icDerive, stationsFor, newConfirmCode } from "./write-ops";

describe("icDerive (Malaysian IC → DOB/gender)", () => {
  it("derives DOB and female from an even last digit", () => {
    expect(icDerive("020604-01-1818")).toEqual({ dob: "2002-06-04", gender: "F" });
  });
  it("derives male from an odd last digit", () => {
    expect(icDerive("040103140521")).toEqual({ dob: "2004-01-03", gender: "M" });
  });
  it("century rule: YY>26 → 19YY", () => {
    expect(icDerive("910828086186")).toEqual({ dob: "1991-08-28", gender: "F" });
  });
  it("rejects impossible calendar dates instead of rolling over", () => {
    expect(icDerive("023199010001")).toEqual({ dob: null, gender: null }); // 31 Feb-ish garbage (month 31)
    expect(icDerive("020230010001")).toEqual({ dob: null, gender: null }); // 30 Feb
  });
  it("rejects non-12-digit input", () => {
    expect(icDerive("12345")).toEqual({ dob: null, gender: null });
  });
});

describe("stationsFor (checklist auto-assign station inference)", () => {
  it("barista → foh", () => {
    expect(stationsFor("Barista")).toEqual(["foh"]);
  });
  it("kitchen crew → boh", () => {
    expect(stationsFor("Kitchen Crew")).toEqual(["boh"]);
  });
  it("floater covers both", () => {
    expect(stationsFor("PT Barista/Kitchen")).toEqual(["foh", "boh"]);
  });
  it("leads get the lead station", () => {
    expect(stationsFor("Barista Lead")).toContain("lead");
  });
});

describe("newConfirmCode", () => {
  it("is 4 chars from the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = newConfirmCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });
});
