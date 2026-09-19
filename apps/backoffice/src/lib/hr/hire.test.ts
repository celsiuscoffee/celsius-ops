import { describe, it, expect } from "vitest";
import {
  icDerive, stationsFor, validateHire, digitsOnly, ROLES, EMPLOYMENT_TYPES,
  type HireInput,
} from "./hire";

const base: HireInput = {
  name: "Shahidan",
  role: "STAFF",
  employmentType: "full_time",
  basicSalary: 1900,
};

describe("icDerive (Malaysian IC → DOB/gender)", () => {
  it("reads a dashed IC", () => {
    expect(icDerive("020604-01-1818")).toEqual({ dob: "2002-06-04", gender: "F" });
  });
  it("reads a bare 12-digit IC", () => {
    expect(icDerive("041221060367")).toEqual({ dob: "2004-12-21", gender: "M" });
  });
  it("uses the ≤26 century rule", () => {
    expect(icDerive("910828086186")).toEqual({ dob: "1991-08-28", gender: "F" });
  });
  it("refuses an impossible date rather than guessing", () => {
    expect(icDerive("023199010001")).toEqual({ dob: null, gender: null });
    expect(icDerive("020230010001")).toEqual({ dob: null, gender: null });
  });
  it("refuses anything that is not 12 digits", () => {
    expect(icDerive("12345")).toEqual({ dob: null, gender: null });
  });
});

describe("stationsFor", () => {
  it("puts a barista front of house", () => {
    expect(stationsFor("Barista")).toEqual(["foh"]);
  });
  it("puts kitchen crew back of house", () => {
    expect(stationsFor("Kitchen Crew")).toEqual(["boh"]);
  });
  it("handles a split position", () => {
    expect(stationsFor("PT Barista/Kitchen")).toEqual(["foh", "boh"]);
  });
  it("adds lead for a lead position", () => {
    expect(stationsFor("Barista Lead")).toContain("lead");
  });
  it("never returns an empty list — an unstationed hire is invisible to checklists", () => {
    expect(stationsFor("")).toEqual(["foh"]);
    for (const p of ["", "Admin", "Head of Operations", "???"]) {
      expect(stationsFor(p).length).toBeGreaterThan(0);
    }
  });
});

describe("validateHire", () => {
  it("accepts a well-formed full-timer", () => {
    expect(validateHire(base)).toBeNull();
  });

  it("requires a name", () => {
    expect(validateHire({ ...base, name: "  " })).toBe("name is required");
  });

  it("rejects a role outside the allowlist", () => {
    expect(validateHire({ ...base, role: "SUPERUSER" as never })).toMatch(/Invalid role/);
  });

  it("refuses a full-timer whose basic salary was left blank", () => {
    // The monthly calculator skips them, so the hire would be unpayable and
    // nobody would find out until the run.
    expect(validateHire({ ...base, basicSalary: null })).toMatch(/basic salary/);
    expect(validateHire({ ...base, basicSalary: undefined })).toMatch(/basic salary/);
  });

  it("allows an explicit zero — an unpaid HQ record is a real thing", () => {
    // Blank is the accident; 0 is a decision. `schedule_required = false`
    // exempts these from the payroll preflight's missing-salary block.
    expect(validateHire({ ...base, basicSalary: 0 })).toBeNull();
  });

  it("refuses a part-timer with no hourly rate", () => {
    const pt = { ...base, employmentType: "part_time", basicSalary: null };
    expect(validateHire({ ...pt, hourlyRate: null })).toMatch(/hourly rate/);
    expect(validateHire({ ...pt, hourlyRate: 9 })).toBeNull();
  });

  it("lets contract and intern hires through on a basic salary", () => {
    for (const employmentType of ["contract", "intern"]) {
      expect(validateHire({ ...base, employmentType })).toBeNull();
    }
  });

  it("treats an unknown employment type as full-time rather than inventing one", () => {
    expect(validateHire({ ...base, employmentType: "casual" })).toBeNull();
    expect(validateHire({ ...base, employmentType: "casual", basicSalary: null }))
      .toMatch(/basic salary/);
  });

  it("requires a 6-digit PIN when one is given", () => {
    expect(validateHire({ ...base, pin: "12345" })).toMatch(/6 digits/);
    expect(validateHire({ ...base, pin: "abcdef" })).toMatch(/6 digits/);
    expect(validateHire({ ...base, pin: "202092" })).toBeNull();
    // No PIN at all is fine — the employee just cannot sign in yet.
    expect(validateHire({ ...base, pin: null })).toBeNull();
  });

  it("rejects a bank account number carrying anything but digits", () => {
    // A letter in an account number is always a typo, never an account.
    expect(validateHire({ ...base, bankAccountNumber: "7653-3596-33" })).toBeNull();
    expect(validateHire({ ...base, bankAccountNumber: "76533O9633" })).toMatch(/digits only/);
  });
});

describe("the shared contract", () => {
  it("allows exactly the four roles the access system knows", () => {
    expect([...ROLES]).toEqual(["STAFF", "MANAGER", "ADMIN", "OWNER"]);
  });
  it("allows exactly the four employment types the profile column accepts", () => {
    expect([...EMPLOYMENT_TYPES]).toEqual(["full_time", "part_time", "contract", "intern"]);
  });
  it("normalises identifiers the same way the duplicate query does", () => {
    expect(digitsOnly("011-3911 7587")).toBe("01139117587");
    expect(digitsOnly("041221-06-0367")).toBe("041221060367");
  });
});
