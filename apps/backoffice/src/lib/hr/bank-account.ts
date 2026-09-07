/**
 * Bank account identity + format checks for staff payments.
 *
 * WHY THIS EXISTS. The weekly PT bank file pays `bankAccountNumber` with
 * `bankAccountName` as the beneficiary (payroll/weekly/bank-file). Nothing ever
 * checked that the account belongs to the employee being paid: the employee
 * PATCH stored whatever string arrived, and preflight only asked whether the
 * fields were non-empty. A staff row therefore carried another person's account
 * — legal name "Muhammad Aiman Bin Mohd Roslan", account holder "Muhammad Aiman
 * Dinie Bin Zulkepli" — and every run paid the wrong human until someone
 * happened to read the two lines side by side (2026-09-07).
 *
 * The two failure shapes seen in production, and what catches each:
 *
 *   1. The account belongs to someone else. Format checks CANNOT see this — the
 *      number is a perfectly valid 12-digit Maybank account. Only comparing the
 *      account holder against the employee's legal name catches it, which is
 *      what `accountNameVerdict` does.
 *   2. A digit was dropped on entry (three Bank Islam accounts stored 13 digits
 *      where BIMB is 14). `accountNumberIssue` catches these.
 */

/** Digit lengths each bank actually issues. Sources: the banks' own M2U/biz
 *  beneficiary rules; widened only with a real account in hand. A bank missing
 *  from this table is length-checked loosely (see `accountNumberIssue`). */
const BANK_LENGTHS: Array<{ match: RegExp; lengths: number[] }> = [
  { match: /maybank/i, lengths: [12] },
  { match: /cimb/i, lengths: [10, 14] },
  { match: /public bank/i, lengths: [10, 11] },
  { match: /rhb/i, lengths: [14] },
  { match: /bank islam/i, lengths: [14] },
  { match: /ambank/i, lengths: [13] },
  { match: /hong leong/i, lengths: [10, 11] },
  { match: /bank rakyat/i, lengths: [12] },
  { match: /bsn|simpanan nasional/i, lengths: [16] },
  { match: /affin/i, lengths: [14] },
  { match: /alliance/i, lengths: [14, 16] },
  { match: /ocbc/i, lengths: [10] },
  { match: /uob/i, lengths: [10, 12] },
  { match: /hsbc/i, lengths: [12] },
  { match: /standard chartered/i, lengths: [12] },
  { match: /agrobank/i, lengths: [16] },
  { match: /muamalat/i, lengths: [14] },
];

/** Absolute bounds for anything we don't have a rule for. No Malaysian
 *  consumer account is shorter than 8 digits or longer than 20. */
const MIN_LEN = 8;
const MAX_LEN = 20;

/** Strip the separators people paste from statements. Returns null when the
 *  result isn't a pure digit string — a letter in an account number is always
 *  a typo, never a real account. */
export function normalizeAccountNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const stripped = value.replace(/[\s-]/g, "");
  if (stripped === "" || !/^\d+$/.test(stripped)) return null;
  return stripped;
}

/**
 * Format problem with an account number, or null when it looks right.
 * `bankName` may be null — then only the loose bounds apply.
 */
export function accountNumberIssue(bankName: string | null | undefined, accountNumber: string): string | null {
  const digits = normalizeAccountNumber(accountNumber);
  if (!digits) return "Account number must be digits only";
  if (digits.length < MIN_LEN || digits.length > MAX_LEN) {
    return `Account number must be ${MIN_LEN}–${MAX_LEN} digits (got ${digits.length})`;
  }
  if (!bankName) return null;
  const rule = BANK_LENGTHS.find((r) => r.match.test(bankName));
  if (!rule) return null;
  if (rule.lengths.includes(digits.length)) return null;
  const expected = rule.lengths.length === 1 ? `${rule.lengths[0]}` : rule.lengths.join(" or ");
  return `${bankName} accounts are ${expected} digits — this one is ${digits.length}. Check for a missing or extra digit.`;
}

/** Honorifics, relationship particles and noise that carry no identity. */
const NAME_NOISE = new Set([
  "BIN", "BINTI", "BT", "BTE", "B", "AL", "AP", "A/L", "A/P",
  "MOHD", "MUHAMMAD", "MUHAMAD", "MOHAMAD", "MOHAMED", "MUHD", "MD",
  "NUR", "NURUL", "SITI", "TENGKU", "ENGKU", "NIK", "CHE", "WAN", "RAJA",
  "DATO", "DATIN", "HAJI", "HAJJAH", "HJ", "HJH",
]);

function identityTokens(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_NOISE.has(t));
}

export type AccountNameVerdict =
  | { status: "ok" }
  | { status: "unverifiable"; reason: string }
  | { status: "mismatch"; foreignTokens: string[]; message: string };

/**
 * Compare the bank's account holder against the employee's legal name.
 *
 * The rule is deliberately one-directional: the holder name may be SHORTER than
 * the legal name ("Aimi Nadhira" for "Aimi Nadhira Binti Dzollani" is the same
 * person — banks truncate), but any *extra* identity token in the holder name
 * that the legal name doesn't have means the account is registered to someone
 * else. That asymmetry is what separates a harmless abbreviation from
 * "Zulkepli" appearing on "Mohd Roslan"'s account.
 *
 * Common given names and honorifics are stripped first, so two unrelated people
 * both called "Muhammad" don't match on that alone.
 */
export function accountNameVerdict(
  legalName: string | null | undefined,
  accountHolderName: string | null | undefined,
): AccountNameVerdict {
  const legal = identityTokens(legalName || "");
  const holder = identityTokens(accountHolderName || "");
  if (holder.length === 0) return { status: "unverifiable", reason: "No account holder name on file" };
  if (legal.length === 0) return { status: "unverifiable", reason: "No full legal name on file" };

  const legalSet = new Set(legal);
  const foreign = holder.filter((t) => !legalSet.has(t));
  if (foreign.length === 0) return { status: "ok" };

  return {
    status: "mismatch",
    foreignTokens: foreign,
    message:
      `Account holder "${accountHolderName}" does not match legal name "${legalName}" ` +
      `(${foreign.join(", ")} appears only on the account). Confirm whose account this is before paying.`,
  };
}
