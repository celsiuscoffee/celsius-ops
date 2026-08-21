// Weekly PT payment file — one bank line per part-timer from a CONFIRMED
// weekly payroll run (owner flow 2026-07-19: managers confirm each PT's
// clocked hours → finance downloads this file → uploads to the bank portal
// (Maybank2u Biz bulk transfer / DuitNow) and approves there → marks the run
// paid). The per-person REFERENCE is the reconciliation key: it lands in the
// bank statement narration, so the finance warehouse can match each outgoing
// line to a payroll item instead of today's untraceable outlet lump sums.
//
// Split-by-outlet (owner 2026-08-20): a PT who clocked at two outlets in the
// week is paid on SEPARATE lines, one per outlet, so each outlet carries its
// own labour cost. The split is exact — each line's amount is the sum of that
// outlet's shifts (paid_hours × rate) — and the per-person lines always add
// back to the person's net_pay to the sen (see allocateByOutlet).
//
// Pure — the route does IO and gating; this file only shapes data.

export type PaymentLine = {
  name: string; // account holder as registered at the bank
  bankName: string;
  accountNumber: string;
  amount: number; // RM
  reference: string; // ≤ 20 chars — bank narration field
  outlet: string; // outlet this line's hours were worked at (display name)
};

// "PTW" + week Monday DDMM + first name, e.g. PTW2007 NURAYUNI.
// IBG/DuitNow recipient-reference fields commonly cap at 20 chars.
//
// When a PT is split across outlets, pass the outlet CODE so each of their
// lines carries a DISTINCT narration (otherwise two debits to the same account
// would be indistinguishable on the statement). The code is kept intact and
// the first name is trimmed to make room — the outlet is what makes the two
// lines reconcile, so it wins the character budget.
export function paymentReference(weekStart: string, personName: string, outletCode?: string): string {
  const ddmm = `${weekStart.slice(8, 10)}${weekStart.slice(5, 7)}`;
  const first = (personName.trim().split(/\s+/)[0] || "PT").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!outletCode) return `PTW${ddmm} ${first}`.slice(0, 20);
  const tag = outletCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prefix = `PTW${ddmm} `;
  // Reserve the code (+ its separating space) at the tail, then fit as much of
  // the first name as the 20-char budget allows in between.
  const budget = 20 - prefix.length - 1 - tag.length;
  const firstPart = budget > 0 ? first.slice(0, budget) : "";
  return `${prefix}${firstPart} ${tag}`.replace(/\s+/g, " ").trim().slice(0, 20);
}

export type ShiftDetail = { paid_hours?: number | string | null; rate?: number | string | null; start?: string };

// Split a person's confirmed net pay across the outlets their shifts were
// worked at, weighting each outlet by its own shifts' pay (paid_hours × rate).
// `outletKeyOf` maps a shift to an outlet key (e.g. outlet id, or a sentinel
// for shifts whose outlet couldn't be resolved).
//
// The returned amounts are rounded to the sen AND reconciled so they sum to
// EXACTLY `netPay`: any rounding residual is pushed onto the largest bucket.
// This is the safety property that matters for a payment file — the person's
// total never drifts from the amount payroll confirmed, no sen is minted or
// lost, only re-attributed across their outlets. Returns [] when there are no
// positive-pay shifts (the caller then falls back to a single line).
export function allocateByOutlet(
  shifts: ShiftDetail[],
  outletKeyOf: (shift: ShiftDetail) => string,
  netPay: number,
): Array<{ outletKey: string; amount: number }> {
  const raw = new Map<string, number>();
  for (const s of shifts) {
    const amt = (Number(s.paid_hours) || 0) * (Number(s.rate) || 0);
    if (amt <= 0) continue;
    const key = outletKeyOf(s);
    raw.set(key, (raw.get(key) ?? 0) + amt);
  }
  const buckets = [...raw.entries()].map(([outletKey, v]) => ({
    outletKey,
    amount: Math.round(v * 100) / 100,
  }));
  if (buckets.length === 0) return [];
  const sum = buckets.reduce((s, b) => s + b.amount, 0);
  const residual = Math.round((netPay - sum) * 100) / 100;
  if (residual !== 0) {
    let idx = 0;
    for (let i = 1; i < buckets.length; i++) {
      if (buckets[i].amount > buckets[idx].amount) idx = i;
    }
    buckets[idx].amount = Math.round((buckets[idx].amount + residual) * 100) / 100;
  }
  return buckets;
}

// Generic bulk-payment CSV: header row + one line per PT-outlet. Columns map
// 1:1 onto Maybank2u Biz / DuitNow bulk upload templates (finance copy-pastes
// or re-saves; the first five columns and their order are stable so a saved
// mapping keeps working). Outlet is appended as a trailing column — the bank
// template reads the first five and ignores it; it's there for our own
// per-outlet reconciliation.
export function buildPaymentCsv(lines: PaymentLine[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    "Beneficiary Name,Bank,Account Number,Amount (RM),Recipient Reference,Outlet",
    ...lines.map((l) =>
      [esc(l.name), esc(l.bankName), esc(l.accountNumber), l.amount.toFixed(2), esc(l.reference), esc(l.outlet)].join(","),
    ),
  ];
  return rows.join("\n") + "\n";
}
