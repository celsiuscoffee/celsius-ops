import { describe, it, expect } from "vitest";
import { contraFor, companyFromAccountName, CONTRA_ACCOUNT } from "./gl-posting-map";

describe("companyFromAccountName", () => {
  it("routes each bank account to its legal entity", () => {
    expect(companyFromAccountName("CELSIUS COFFEE CONEZION SDN. BHD. (2644)")).toBe("celsiusconezion");
    expect(companyFromAccountName("CELSIUS COFFEE TAMARIND SDN. BHD. (9345)")).toBe("celsiustamarind");
    expect(companyFromAccountName("CELSIUS COFFEE SDN. BHD. (4384)")).toBe("celsius");
  });
  it("defaults the HQ account (Shah Alam + Nilai) to celsius", () => {
    expect(companyFromAccountName("SOMETHING UNEXPECTED")).toBe("celsius");
  });
});

describe("contraFor", () => {
  it("clears debtors for settlement inflows (revenue already accrued by EOD)", () => {
    expect(contraFor("CARD")).toEqual({ code: "1006", suspense: false });
    expect(contraFor("GRAB")).toEqual({ code: "1005", suspense: false });
    expect(contraFor("QR")).toEqual({ code: "1000-02", suspense: false });
  });
  it("recognises income for channels not in EOD", () => {
    expect(contraFor("GASTROHUB")).toEqual({ code: "5000-09", suspense: false });
    expect(contraFor("MEETINGS_EVENTS")).toEqual({ code: "5000-10", suspense: false });
    expect(contraFor("REVENUE_MONSTER")).toEqual({ code: "5000-01", suspense: false });
  });
  it("maps costs, capex and financing to real accounts", () => {
    expect(contraFor("RAW_MATERIALS").code).toBe("6000-01");
    expect(contraFor("DIGITAL_ADS").code).toBe("6503-01");
    expect(contraFor("RENT").code).toBe("6504");
    expect(contraFor("EQUIPMENTS").code).toBe("1500-02");
    expect(contraFor("LOAN").code).toBe("3010");
    expect(contraFor("DIRECTORS_ALLOWANCE").code).toBe("3400");
    // every mapped account code is well-formed (4-digit, optional -NN sub)
    Object.values(CONTRA_ACCOUNT).forEach((code) => expect(code).toMatch(/^\d{4}(-\d{2})?$/));
  });
  it("parks unclassified + inter-company in suspense so the bank still ties out", () => {
    expect(contraFor("OTHER_OUTFLOW")).toEqual({ code: "1999", suspense: true });
    expect(contraFor("OTHER_INFLOW")).toEqual({ code: "1999", suspense: true });
    expect(contraFor("INTERCO_PEOPLE")).toEqual({ code: "1999", suspense: true });
    expect(contraFor("GRAB_PUTRAJAYA")).toEqual({ code: "1999", suspense: false }); // mapped explicitly to suspense (cross-entity), not an unknown
  });
  it("never throws on an unknown category — routes to suspense", () => {
    expect(contraFor("SOME_FUTURE_CATEGORY")).toEqual({ code: "1999", suspense: true });
  });
});
