import { describe, it, expect } from "vitest";
import { normalizeAccountNumber, accountNumberIssue, accountNameVerdict } from "./bank-account";

// Names here are synthetic but keep the exact SHAPES seen in the live data —
// Malay patronymics, honorific prefixes, bank truncation, a wrong-person
// account. Real staff names and account numbers stay out of the repo.

describe("normalizeAccountNumber", () => {
  it("strips the separators people paste from statements", () => {
    expect(normalizeAccountNumber("1620 1234 5678")).toBe("162012345678");
    expect(normalizeAccountNumber("7642-577-863")).toBe("7642577863");
  });

  it("refuses anything that isn't purely digits", () => {
    // A letter in an account number is always a typo, never a real account.
    expect(normalizeAccountNumber("16201234567O")).toBeNull();
    expect(normalizeAccountNumber("")).toBeNull();
    expect(normalizeAccountNumber("   ")).toBeNull();
    expect(normalizeAccountNumber(null)).toBeNull();
    expect(normalizeAccountNumber(12345678)).toBeNull();
  });
});

describe("accountNumberIssue", () => {
  it("accepts the real length for each bank", () => {
    expect(accountNumberIssue("Maybank", "162012345678")).toBeNull();
    expect(accountNumberIssue("Maybank Islamic Berhad", "151012345678")).toBeNull();
    expect(accountNumberIssue("CIMB Bank Berhad", "7642577863")).toBeNull();
    expect(accountNumberIssue("Bank Islam", "12074022606661")).toBeNull();
    expect(accountNumberIssue("RHB Bank", "10130360254219")).toBeNull();
    expect(accountNumberIssue("AmBank", "8881040262129")).toBeNull();
    expect(accountNumberIssue("Hong Leong Bank", "06750305217")).toBeNull();
  });

  it("catches the dropped digit — three live Bank Islam rows stored 13 of 14", () => {
    const issue = accountNumberIssue("Bank Islam Malaysia Berhad", "5076023954104");
    expect(issue).toContain("14");
    expect(issue).toContain("13");
  });

  it("catches a Maybank account that is really a CIMB one", () => {
    // 10 digits saved against Maybank = the number belongs to another bank.
    expect(accountNumberIssue("Maybank", "7642577863")).toContain("12 digits");
  });

  it("falls back to loose bounds for a bank with no rule", () => {
    expect(accountNumberIssue("Some Co-op Bank", "123456789012")).toBeNull();
    expect(accountNumberIssue("Some Co-op Bank", "1234")).toContain("8–20 digits");
  });

  it("checks length even with no bank named", () => {
    expect(accountNumberIssue(null, "162012345678")).toBeNull();
    expect(accountNumberIssue(null, "12")).toContain("8–20 digits");
  });
});

describe("accountNameVerdict", () => {
  it("flags an account registered to a different person", () => {
    // The live case: same given name, different patronymic — paid for months.
    const v = accountNameVerdict("Muhammad Aiman Bin Mohd Roslan", "Muhammad Aiman Dinie Bin Zulkepli");
    expect(v.status).toBe("mismatch");
    if (v.status === "mismatch") {
      expect(v.foreignTokens).toContain("ZULKEPLI");
      expect(v.foreignTokens).toContain("DINIE");
    }
  });

  it("flags a completely different surname behind a shared given name", () => {
    const v = accountNameVerdict("Mohd Haziq Bin Mohd Zaini", "Haziq Ashraff");
    expect(v.status).toBe("mismatch");
    if (v.status === "mismatch") expect(v.foreignTokens).toEqual(["ASHRAFF"]);
  });

  it("accepts a bank truncation — the holder name may be SHORTER", () => {
    // Banks routinely drop the patronymic; that is the same human.
    expect(accountNameVerdict("Aimi Nadhira Binti Dzollani", "Aimi Nadhira").status).toBe("ok");
    expect(accountNameVerdict("Muhammad Adib Bin Zulkifli", "MUHAMMAD ADIB").status).toBe("ok");
  });

  it("ignores case, punctuation and the bin/binti particles", () => {
    expect(accountNameVerdict("Nur Atthira Bt M Salleh", "Nur Atthira binti M Salleh").status).toBe("ok");
    expect(accountNameVerdict("Muhammad Arfan Kamaruzaman", "Muhammad Arfan Bin Kamaruzaman").status).toBe("ok");
    expect(accountNameVerdict("Ariff Izham Bin Abd Rahman", "Ariff Izham Abd Rahman").status).toBe("ok");
  });

  it("does not match two different people on a common given name alone", () => {
    // "Muhammad"/"Nur" are too common to be identity — stripped from both sides,
    // so these must still come out as a mismatch rather than a match.
    expect(accountNameVerdict("Muhammad Farid Bin Osman", "Muhammad Halim Bin Yusof").status).toBe("mismatch");
    expect(accountNameVerdict("Nur Aisyah Binti Karim", "Nur Salma Binti Karim").status).toBe("mismatch");
  });

  it("flags an annotation smuggled into the beneficiary name", () => {
    // "(Bigpay)" would be sent to the bank as part of the payee name.
    const v = accountNameVerdict("Muhammad Adam Bin Arman", "Muhammad Adam bin Arman (Bigpay)");
    expect(v.status).toBe("mismatch");
    if (v.status === "mismatch") expect(v.foreignTokens).toEqual(["BIGPAY"]);
  });

  it("reports unverifiable rather than ok when either name is missing", () => {
    expect(accountNameVerdict("Siti Aminah Binti Hassan", null).status).toBe("unverifiable");
    expect(accountNameVerdict("Siti Aminah Binti Hassan", "").status).toBe("unverifiable");
    expect(accountNameVerdict(null, "Siti Aminah Binti Hassan").status).toBe("unverifiable");
    // A legal name of nothing but honorifics carries no identity either.
    expect(accountNameVerdict("Bin Binti", "Siti Aminah").status).toBe("unverifiable");
  });

  it("never reports ok for a name that shares nothing at all", () => {
    expect(accountNameVerdict("Tan Wei Ming", "Kumar Subramaniam").status).toBe("mismatch");
  });
});
