import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { activeFlags, flagLabel, type InvoiceFlag } from "@/lib/inventory/flag-detector";

// GET /api/inventory/invoices/reconciliation
//
// The procurement "statement of account" view. The flat invoices list answers
// "what do we owe right now"; this answers the money-matching questions that
// 17 real supplier chats showed were the #1 recurring pain: "which invoice is
// this PoP for", short/partial/double payments, missing delivery charges, and
// carry-forward balances. We group supplier invoices into a per-supplier
// statement (outstanding + aging) and surface the reconciliation EXCEPTIONS —
// the rows a human needs to match or chase.
//
// Overpayment never lands as amountPaid > amount (the payment route clamps
// amountPaid to the invoice total). Double/over/wrong-account payments are
// caught by the per-invoice flags written by flag-detector at payment time, so
// the ledger surfaces those flags rather than recomputing them.

// Open = a real, verified liability still owed. DRAFT is excluded from the
// outstanding total (provisional / AI-captured, amount not yet confirmed) but
// still surfaced as a "verify" exception below.
const OPEN_STATUSES = ["PENDING", "INITIATED", "PARTIALLY_PAID", "DEPOSIT_PAID", "OVERDUE"] as const;
const TOLERANCE = 0.01;

type ExceptionKind = "FLAGGED" | "SHORT_PAID" | "CARRY_FORWARD" | "UNVERIFIED" | "OVERDUE";

type Exception = {
  invoiceId: string;
  invoiceNumber: string;
  poNumber: string | null;
  status: string;
  amount: number;
  amountPaid: number;
  balance: number;
  issueDate: string;
  dueDate: string | null;
  ageDays: number;
  kinds: ExceptionKind[];
  // Short human summary of why this row needs reconciliation attention.
  reason: string;
  flags: { code: string; label: string; message: string }[];
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Optional supplier filter — same repeated-param shape as the invoices list.
  const supplierIds = req.nextUrl.searchParams.getAll("supplier").filter(Boolean);

  // Only real supplier (AP) invoices reconcile against a statement. Staff
  // claims, internal transfers and one-off payment requests have null
  // supplierId and no supplier statement, so they're excluded naturally by
  // requiring a supplierId.
  const invoices = await prisma.invoice.findMany({
    where: {
      paymentType: "SUPPLIER",
      supplierId: supplierIds.length ? { in: supplierIds } : { not: null },
      // Exclude finance one-off vendor payment requests (also paymentType
      // SUPPLIER) but keep ad-hoc supplier invoices with no PO attached.
      NOT: { order: { is: { orderType: "PAYMENT_REQUEST" } } },
    },
    select: {
      id: true,
      invoiceNumber: true,
      amount: true,
      amountPaid: true,
      status: true,
      issueDate: true,
      dueDate: true,
      paidAt: true,
      aiPrefilledAt: true,
      flags: true,
      supplierId: true,
      supplier: { select: { id: true, name: true, paymentTerms: true } },
      order: { select: { orderNumber: true } },
    },
    orderBy: { issueDate: "asc" },
  });

  type SupplierRow = {
    supplierId: string;
    supplierName: string;
    paymentTerms: string | null;
    outstanding: number;
    openCount: number;
    overdueAmount: number;
    overdueCount: number;
    oldestOpenDays: number;
    exceptions: Exception[];
  };

  const bySupplier = new Map<string, SupplierRow>();

  for (const inv of invoices) {
    const supplierId = inv.supplierId;
    if (!supplierId) continue;
    let row = bySupplier.get(supplierId);
    if (!row) {
      row = {
        supplierId,
        supplierName: inv.supplier?.name ?? "Unknown supplier",
        paymentTerms: inv.supplier?.paymentTerms ?? null,
        outstanding: 0,
        openCount: 0,
        overdueAmount: 0,
        overdueCount: 0,
        oldestOpenDays: 0,
        exceptions: [],
      };
      bySupplier.set(supplierId, row);
    }

    const amount = Number(inv.amount);
    const amountPaid = Number(inv.amountPaid ?? 0);
    const balance = Math.round((amount - amountPaid) * 100) / 100;
    const isOpen = (OPEN_STATUSES as readonly string[]).includes(inv.status);
    const isDraft = inv.status === "DRAFT";
    const ageDays = daysBetween(inv.issueDate, now);
    const isOverdue = inv.dueDate != null && inv.dueDate < todayStart && balance > TOLERANCE && (isOpen || isDraft);

    if (isOpen && balance > TOLERANCE) {
      row.outstanding += balance;
      row.openCount += 1;
      row.oldestOpenDays = Math.max(row.oldestOpenDays, ageDays);
    }
    if (isOverdue) {
      row.overdueAmount += balance;
      row.overdueCount += 1;
    }

    // ─── Reconciliation exceptions ───────────────────────────
    const flags = activeFlags(inv.flags);
    const kinds: ExceptionKind[] = [];
    const reasons: string[] = [];

    if (flags.length > 0) {
      kinds.push("FLAGGED");
      reasons.push(flags.map((f) => flagLabel(f.code as InvoiceFlag["code"]) ?? f.code).join(", "));
    }
    // PAID but we applied less than billed — supplier "short paid 80 cents"
    // / a post-payment amount edit. amountPaid is clamped to amount on the
    // way up, so this only happens when the billed amount exceeds what was
    // settled: a genuine residual the supplier will still chase.
    if (inv.status === "PAID" && balance > TOLERANCE) {
      kinds.push("SHORT_PAID");
      reasons.push(`Marked paid but RM ${balance.toFixed(2)} short of billed`);
    }
    // Deposit/partial with a remaining balance carried forward.
    if ((inv.status === "PARTIALLY_PAID" || inv.status === "DEPOSIT_PAID") && balance > TOLERANCE) {
      kinds.push("CARRY_FORWARD");
      reasons.push(`RM ${balance.toFixed(2)} balance outstanding after part payment`);
    }
    // AI-captured / draft invoice whose amount is still provisional.
    if (isDraft || inv.aiPrefilledAt != null) {
      kinds.push("UNVERIFIED");
      reasons.push(inv.aiPrefilledAt ? "AI-captured — amount not yet verified" : "Draft — not yet verified");
    }
    if (isOverdue) {
      kinds.push("OVERDUE");
      reasons.push(`Overdue ${inv.dueDate ? daysBetween(inv.dueDate, now) : 0}d — RM ${balance.toFixed(2)} owed`);
    }

    if (kinds.length > 0) {
      row.exceptions.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        poNumber: inv.order?.orderNumber ?? null,
        status: inv.status,
        amount: Math.round(amount * 100) / 100,
        amountPaid: Math.round(amountPaid * 100) / 100,
        balance,
        issueDate: inv.issueDate.toISOString().split("T")[0],
        dueDate: inv.dueDate?.toISOString().split("T")[0] ?? null,
        ageDays,
        kinds,
        reason: reasons.join(" · "),
        flags: flags.map((f) => ({
          code: f.code,
          label: flagLabel(f.code as InvoiceFlag["code"]) ?? f.code,
          message: f.message,
        })),
      });
    }
  }

  // Sort exceptions within each supplier: flagged money-matching issues first
  // (highest risk), then by age. Sort suppliers by exception count then
  // outstanding so the rows that need a human bubble up.
  const kindRank: Record<ExceptionKind, number> = { FLAGGED: 0, SHORT_PAID: 1, OVERDUE: 2, CARRY_FORWARD: 3, UNVERIFIED: 4 };
  const suppliers = [...bySupplier.values()]
    .map((s) => {
      s.outstanding = Math.round(s.outstanding * 100) / 100;
      s.overdueAmount = Math.round(s.overdueAmount * 100) / 100;
      s.exceptions.sort((a, b) => {
        const ra = Math.min(...a.kinds.map((k) => kindRank[k]));
        const rb = Math.min(...b.kinds.map((k) => kindRank[k]));
        return ra - rb || b.ageDays - a.ageDays;
      });
      return s;
    })
    // Hide fully-settled suppliers with nothing to reconcile.
    .filter((s) => s.outstanding > TOLERANCE || s.exceptions.length > 0)
    .sort((a, b) => b.exceptions.length - a.exceptions.length || b.outstanding - a.outstanding);

  const totals = suppliers.reduce(
    (acc, s) => {
      acc.outstanding += s.outstanding;
      acc.openCount += s.openCount;
      acc.overdueAmount += s.overdueAmount;
      acc.overdueCount += s.overdueCount;
      acc.exceptionCount += s.exceptions.length;
      acc.flaggedCount += s.exceptions.filter((e) => e.kinds.includes("FLAGGED")).length;
      return acc;
    },
    { outstanding: 0, openCount: 0, overdueAmount: 0, overdueCount: 0, exceptionCount: 0, flaggedCount: 0, supplierCount: suppliers.length },
  );
  totals.outstanding = Math.round(totals.outstanding * 100) / 100;
  totals.overdueAmount = Math.round(totals.overdueAmount * 100) / 100;

  return NextResponse.json({ suppliers, totals });
}
