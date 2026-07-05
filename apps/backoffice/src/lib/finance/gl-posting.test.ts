import { describe, it, expect } from "vitest";
import {
  contraFor, companyFromAccountName, CONTRA_ACCOUNT, resolveContra,
  GL_POSTING_CUTOVER, INTERCO_DUE_ACCOUNT, resolveGrabSettlementRouting,
} from "./gl-posting-map";
import {
  bankCrossEntityJournalKey, bankJournalKey, bankMirrorJournalKey,
  buildBankGroups, type GroupableBankLine,
} from "./gl-posting";

describe("resolveContra — Bukku-accurate control / inter-co routing", () => {
  it("routes full-time salary to the Salary Control liability (cleared by payroll accrual)", () => {
    expect(resolveContra("EMPLOYEE_SALARY", "SALARY DEC 2025").code).toBe("3008");
  });
  it("keeps part-timer wages as a direct expense (matches Bukku)", () => {
    expect(resolveContra("PARTIMER", "PT Week 51/25").code).toBe("6500-03");
  });
  it("splits statutory by type into the right control account", () => {
    expect(resolveContra("STATUTORY_PAYMENT", "KWSP/EPF DEC").code).toBe("3004");
    expect(resolveContra("STATUTORY_PAYMENT", "PERKESO SOCSO").code).toBe("3005");
    expect(resolveContra("STATUTORY_PAYMENT", "EIS SIP").code).toBe("3006");
    expect(resolveContra("STATUTORY_PAYMENT", "LHDN PCB MTD").code).toBe("3007");
    expect(resolveContra("STATUTORY_PAYMENT", "statutory misc").code).toBe("3008");
  });
  it("routes inter-company to the right Due to/from account by counterparty", () => {
    expect(resolveContra("INTERCO_PEOPLE", "TRANSFER TO A/C CELSIUS COFFEE TAMARIND").code).toBe("3600-00");
    expect(resolveContra("INTERCO_EXPENSES", "TRANSFER FR A/C CONEZION").code).toBe("3600-01");
    expect(resolveContra("INTERCO_RAW_MATERIAL", "to celsius coffee sdn bhd").code).toBe("3600-02");
    expect(resolveContra("INTERCO_INVESTMENTS", "unknown counterparty").code).toBe("3600");
  });
  it("falls through to the static map for everything else", () => {
    expect(resolveContra("RAW_MATERIALS", "").code).toBe("6000-01");
    expect(resolveContra("DIRECTORS_ALLOWANCE", "").code).toBe("3400");
    expect(resolveContra("OTHER_OUTFLOW", "").suspense).toBe(true);
  });
});

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
  });
  it("clears the Cash & QR debtor for Revenue Monster settlements (already accrued by EOD)", () => {
    expect(contraFor("REVENUE_MONSTER")).toEqual({ code: "1000-02", suspense: false });
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

// ── posting cutover + cross-entity Grab settlement routing ──

const SB_ACCT = "CELSIUS COFFEE SDN. BHD. (4384)";
const OUTLET_COMPANY = new Map([
  ["outlet-sa", "celsius"],
  ["outlet-nilai", "celsius"],
  ["outlet-conezion", "celsiusconezion"],
  ["outlet-tamarind", "celsiustamarind"],
]);

function line(over: Partial<GroupableBankLine> = {}): GroupableBankLine {
  return {
    id: "l1",
    txnDate: new Date("2026-06-01T00:00:00Z"),
    amount: 100,
    direction: "CR",
    category: "GRAB",
    description: "1575371GPAY NETWORK (M) SDN",
    outletId: null,
    accountName: SB_ACCT,
    ...over,
  };
}

describe("GL_POSTING_CUTOVER filtering", () => {
  it("is the agreed 2026 opening date", () => {
    expect(GL_POSTING_CUTOVER).toBe("2026-01-01");
  });
  it("drops pre-cutover lines from grouping regardless of classification", () => {
    const { groups, skippedLines } = buildBankGroups(
      [line({ id: "old", txnDate: new Date("2025-12-31T00:00:00Z"), category: "RENT", direction: "DR" })],
      OUTLET_COMPANY,
    );
    expect(groups.size).toBe(0);
    expect(skippedLines).toBe(1);
  });
  it("keeps lines dated exactly on the cutover", () => {
    const { groups, skippedLines } = buildBankGroups(
      [line({ txnDate: new Date("2026-01-01T00:00:00Z") })],
      OUTLET_COMPANY,
    );
    expect(groups.size).toBe(1);
    expect(skippedLines).toBe(0);
  });
});

describe("resolveGrabSettlementRouting", () => {
  it("routes a Grab payout for another company's outlet through the inter-co accounts", () => {
    const r = resolveGrabSettlementRouting("GRAB", "celsius", "celsiusconezion");
    expect(r).toEqual({
      contra: "3600-01",
      mirror: { company: "celsiusconezion", debitAccount: "3600-02", creditAccount: "1005" },
    });
    const t = resolveGrabSettlementRouting("GRAB", "celsius", "celsiustamarind");
    expect(t?.contra).toBe("3600-00");
    expect(t?.mirror).toEqual({ company: "celsiustamarind", debitAccount: "3600-02", creditAccount: "1005" });
  });
  it("keeps own-outlet settlements on the plain single-journal path", () => {
    expect(resolveGrabSettlementRouting("GRAB", "celsius", "celsius")).toBeNull();
    expect(resolveGrabSettlementRouting("GRAB", "celsius", null)).toBeNull();
  });
  it("resolves the legacy GRAB_PUTRAJAYA label to Conezion when no outlet is stamped", () => {
    const r = resolveGrabSettlementRouting("GRAB_PUTRAJAYA", "celsius", null);
    expect(r?.contra).toBe("3600-01");
    expect(r?.mirror.company).toBe("celsiusconezion");
  });
  it("ignores non-Grab categories and unknown companies", () => {
    expect(resolveGrabSettlementRouting("CARD", "celsius", "celsiusconezion")).toBeNull();
    expect(resolveGrabSettlementRouting("GRAB", "celsius", "somebody-else")).toBeNull();
  });
  it("keeps the inter-co account map aligned with the narrative resolver", () => {
    expect(resolveContra("INTERCO_PEOPLE", "TRANSFER FR A/C CONEZION").code).toBe(INTERCO_DUE_ACCOUNT.celsiusconezion);
    expect(resolveContra("INTERCO_PEOPLE", "TRANSFER TO A/C CELSIUS COFFEE TAMARIND").code).toBe(INTERCO_DUE_ACCOUNT.celsiustamarind);
    expect(resolveContra("INTERCO_PEOPLE", "to celsius coffee sdn bhd").code).toBe(INTERCO_DUE_ACCOUNT.celsius);
  });
});

describe("buildBankGroups Grab settlement grouping", () => {
  it("keeps own-outlet Grab as a single journal clearing SB's 1005", () => {
    const { groups } = buildBankGroups([line({ outletId: "outlet-sa" })], OUTLET_COMPANY);
    expect(groups.size).toBe(1);
    const g = [...groups.values()][0];
    expect(g.company).toBe("celsius");
    expect(g.contra).toBe("1005");
    expect(g.mirror).toBeUndefined();
  });
  it("routes cross-entity Grab to the inter-co contra with a mirror in the outlet's company", () => {
    const { groups } = buildBankGroups(
      [
        line({ id: "a", outletId: "outlet-conezion", amount: 100 }),
        line({ id: "b", outletId: "outlet-conezion", amount: 150.5 }),
      ],
      OUTLET_COMPANY,
    );
    expect(groups.size).toBe(1);
    const g = [...groups.values()][0];
    expect(g.company).toBe("celsius");
    expect(g.contra).toBe("3600-01");
    expect(g.amount).toBe(250.5);
    expect(g.lineIds).toEqual(["a", "b"]);
    expect(g.mirror).toEqual({ company: "celsiusconezion", debitAccount: "3600-02", creditAccount: "1005" });
  });
  it("never folds a cross-entity Grab group into a plain inter-co group on the same contra and day", () => {
    const { groups } = buildBankGroups(
      [
        line({ id: "grab", outletId: "outlet-conezion", amount: 100 }),
        line({
          id: "interco", outletId: "outlet-conezion", amount: 500,
          category: "INTERCO_PEOPLE", description: "TRANSFER FR A/C CONEZION",
        }),
      ],
      OUTLET_COMPANY,
    );
    expect(groups.size).toBe(2);
    const grab = [...groups.values()].find((g) => g.category === "GRAB");
    const interco = [...groups.values()].find((g) => g.category === "INTERCO_PEOPLE");
    expect(grab?.contra).toBe("3600-01");
    expect(interco?.contra).toBe("3600-01");
    expect(grab?.mirror).toBeDefined();
    expect(interco?.mirror).toBeUndefined();
  });
});

describe("cross-entity journal keys", () => {
  const args = ["celsius", "outlet-conezion", "3600-01", "2026-06-01", "CR"] as const;
  it("are stable across runs and distinct from the plain and mirror keys", () => {
    const primary1 = bankCrossEntityJournalKey(...args);
    const primary2 = bankCrossEntityJournalKey(...args);
    expect(primary1).toBe(primary2);
    expect(primary1).not.toBe(bankJournalKey(...args));
    const mirror1 = bankMirrorJournalKey(primary1);
    const mirror2 = bankMirrorJournalKey(primary2);
    expect(mirror1).toBe(mirror2);
    expect(mirror1).not.toBe(primary1);
  });
  it("format as UUIDs so they fit fin_transactions.posting_key", () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const primary = bankCrossEntityJournalKey(...args);
    expect(primary).toMatch(uuid);
    expect(bankMirrorJournalKey(primary)).toMatch(uuid);
    expect(bankJournalKey(...args)).toMatch(uuid);
  });
  it("produce the same pair for identical group aggregations across two runs", () => {
    const input = [line({ id: "a", outletId: "outlet-conezion" })];
    const run1 = [...buildBankGroups(input, OUTLET_COMPANY).groups.values()][0];
    const run2 = [...buildBankGroups(input, OUTLET_COMPANY).groups.values()][0];
    const key1 = bankCrossEntityJournalKey(run1.company, run1.outletId, run1.contra, run1.date, run1.direction);
    const key2 = bankCrossEntityJournalKey(run2.company, run2.outletId, run2.contra, run2.date, run2.direction);
    expect(key1).toBe(key2);
    expect(bankMirrorJournalKey(key1)).toBe(bankMirrorJournalKey(key2));
  });
});
