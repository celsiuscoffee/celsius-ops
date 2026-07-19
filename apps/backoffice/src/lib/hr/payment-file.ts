// Weekly PT payment file — one bank line per part-timer from a CONFIRMED
// weekly payroll run (owner flow 2026-07-19: managers confirm each PT's
// clocked hours → finance downloads this file → uploads to the bank portal
// (Maybank2u Biz bulk transfer / DuitNow) and approves there → marks the run
// paid). The per-person REFERENCE is the reconciliation key: it lands in the
// bank statement narration, so the finance warehouse can match each outgoing
// line to a payroll item instead of today's untraceable outlet lump sums.
//
// Pure — the route does IO and gating; this file only shapes data.

export type PaymentLine = {
  name: string; // account holder as registered at the bank
  bankName: string;
  accountNumber: string;
  amount: number; // RM
  reference: string; // ≤ 20 chars — bank narration field
};

// "PTW" + week Monday DDMM + first name, e.g. PTW2007 NURAYUNI.
// IBG/DuitNow recipient-reference fields commonly cap at 20 chars.
export function paymentReference(weekStart: string, personName: string): string {
  const ddmm = `${weekStart.slice(8, 10)}${weekStart.slice(5, 7)}`;
  const first = (personName.trim().split(/\s+/)[0] || "PT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `PTW${ddmm} ${first}`.slice(0, 20);
}

// Generic bulk-payment CSV: header row + one line per PT. Columns chosen to
// map 1:1 onto Maybank2u Biz / DuitNow bulk upload templates (finance
// copy-pastes or re-saves; column order is stable so a saved mapping works).
export function buildPaymentCsv(lines: PaymentLine[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    "Beneficiary Name,Bank,Account Number,Amount (RM),Recipient Reference",
    ...lines.map((l) =>
      [esc(l.name), esc(l.bankName), esc(l.accountNumber), l.amount.toFixed(2), esc(l.reference)].join(","),
    ),
  ];
  return rows.join("\n") + "\n";
}
