import { describe, it, expect } from "vitest";
import { matchBankLine, settlementStatus, type BankLine, type Candidate } from "./matcher-rules";

function line(amount: number, date: string, opts: Partial<BankLine> = {}): BankLine {
  return { id: "bt1", amount, date, description: "d", reference: null, bankAccountCode: "1000-01", ...opts };
}
function cand(opts: Partial<Candidate> & Pick<Candidate, "id" | "direction" | "outstanding" | "date">): Candidate {
  return { type: "invoice", number: null, outletId: null, ...opts } as Candidate;
}

describe("matchBankLine", () => {
  it("matches exact reference + amount at confidence 1.0", () => {
    const d = matchBankLine(line(100, "2026-06-10", { reference: "INV-7" }), [
      cand({ id: "i1", direction: "ar", outstanding: 100, date: "2026-06-10", number: "INV-7" }),
      cand({ id: "i2", direction: "ar", outstanding: 100, date: "2026-06-10", number: "INV-9" }),
    ]);
    expect(d.kind).toBe("matched");
    if (d.kind === "matched") {
      expect(d.candidateId).toBe("i1");
      expect(d.confidence).toBe(1.0);
      expect(d.rule).toBe("reference_exact");
      expect(d.amountMatched).toBe(100);
    }
  });

  it("matches exact amount on the same date at 0.97", () => {
    const d = matchBankLine(line(250.5, "2026-06-10"), [
      cand({ id: "i1", direction: "ar", outstanding: 250.5, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("matched");
    if (d.kind === "matched") {
      expect(d.rule).toBe("amount_date_exact");
      expect(d.confidence).toBe(0.97);
    }
  });

  it("matches exact amount within the date window at 0.95", () => {
    const d = matchBankLine(line(80, "2026-06-12"), [
      cand({ id: "i1", direction: "ar", outstanding: 80, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("matched");
    if (d.kind === "matched") expect(d.rule).toBe("amount_within_window");
  });

  it("matches within rounding tolerance at 0.90", () => {
    const d = matchBankLine(line(80.02, "2026-06-10"), [
      cand({ id: "i1", direction: "ar", outstanding: 80, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("matched");
    if (d.kind === "matched") {
      expect(d.rule).toBe("amount_rounding");
      expect(d.amountMatched).toBe(80); // never over-apply beyond outstanding
    }
  });

  it("routes outflow to AP and ignores AR candidates", () => {
    const d = matchBankLine(line(-500, "2026-06-10"), [
      cand({ id: "i1", direction: "ar", outstanding: 500, date: "2026-06-10" }), // wrong direction
      cand({ id: "b1", type: "bill", direction: "ap", outstanding: 500, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("matched");
    if (d.kind === "matched") {
      expect(d.candidateId).toBe("b1");
      expect(d.candidateType).toBe("bill");
    }
  });

  it("returns an exception when two candidates tie above threshold", () => {
    const d = matchBankLine(line(100, "2026-06-10"), [
      cand({ id: "i1", direction: "ar", outstanding: 100, date: "2026-06-10" }),
      cand({ id: "i2", direction: "ar", outstanding: 100, date: "2026-06-11" }),
    ]);
    expect(d.kind).toBe("exception");
    if (d.kind === "exception") {
      expect(d.reason).toMatch(/2 candidates/);
      expect(d.proposed?.candidateId).toBe("i1"); // closest date proposed
    }
  });

  it("exceptions when a reference matches but the amount disagrees, proposing the ref hit", () => {
    const d = matchBankLine(line(120, "2026-06-10", { reference: "INV-7" }), [
      cand({ id: "i1", direction: "ar", outstanding: 100, date: "2026-06-10", number: "INV-7" }),
    ]);
    expect(d.kind).toBe("exception");
    if (d.kind === "exception") expect(d.proposed?.candidateId).toBe("i1");
  });

  it("exceptions when exact amount is outside the date window", () => {
    const d = matchBankLine(line(100, "2026-06-20"), [
      cand({ id: "i1", direction: "ar", outstanding: 100, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("exception");
    if (d.kind === "exception") expect(d.proposed?.candidateId).toBe("i1");
  });

  it("exceptions with no proposal when no candidate exists for the direction", () => {
    const d = matchBankLine(line(100, "2026-06-10"), [
      cand({ id: "b1", type: "bill", direction: "ap", outstanding: 100, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("exception");
    if (d.kind === "exception") expect(d.proposed).toBeNull();
  });

  it("ignores fully-paid candidates (zero outstanding)", () => {
    const d = matchBankLine(line(100, "2026-06-10"), [
      cand({ id: "i1", direction: "ar", outstanding: 0, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("exception");
  });

  it("exceptions on a zero-amount bank line", () => {
    const d = matchBankLine(line(0, "2026-06-10"), [
      cand({ id: "i1", direction: "ar", outstanding: 100, date: "2026-06-10" }),
    ]);
    expect(d.kind).toBe("exception");
    if (d.kind === "exception") expect(d.reason).toMatch(/zero-amount/);
  });
});

describe("settlementStatus", () => {
  it("is paid only once the cent gap closes, partial otherwise", () => {
    expect(settlementStatus(100, 100)).toBe("paid");
    expect(settlementStatus(100, 99.997)).toBe("paid"); // within the cent tolerance
    expect(settlementStatus(100, 60)).toBe("partial");
    expect(settlementStatus(100, 100.5)).toBe("paid"); // slight over-apply still paid
  });
});
