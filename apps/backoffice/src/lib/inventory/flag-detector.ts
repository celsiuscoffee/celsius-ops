import { prisma } from "@/lib/prisma";
import type { Prisma } from "@celsius/db";

// Review flags raised by the auto-matcher or the duplicate-invoice guard.
// Stored as jsonb on Invoice.flags. UI shows a warning badge + dialog so the
// user can dismiss (accept as a false alarm) or act on them.
export type InvoiceFlagCode =
  | "DUPLICATE_PO"
  | "DUPLICATE_PAYMENT_REF"
  | "REF_MATCHES_PAID_INVOICE"
  | "AMOUNT_TOLERANCE_MATCH"
  | "BANK_MISMATCH"
  // The POP-match verifier (AI) thinks this unpaid invoice was actually paid by a POP the
  // deterministic matcher dropped — surfaced for finance to confirm. meta holds the verdict.
  | "POP_VERIFIER"
  // The AI-extracted invoice number's shape doesn't match this supplier's usual
  // numbering (e.g. an "IVCT-#" number on a "1-15xxx" supplier) — likely the
  // wrong document was attached. Verify against the photo.
  | "NUMBER_FORMAT_MISMATCH";

export type InvoiceFlag = {
  code: InvoiceFlagCode;
  message: string;
  detectedAt: string;
  dismissed?: boolean;
  dismissedAt?: string;
  dismissedById?: string;
  meta?: Record<string, unknown>;
};

const FLAG_LABEL: Record<InvoiceFlagCode, string> = {
  DUPLICATE_PO: "Duplicate PO invoice",
  DUPLICATE_PAYMENT_REF: "Payment reference already used",
  REF_MATCHES_PAID_INVOICE: "Reference points to a paid invoice",
  AMOUNT_TOLERANCE_MATCH: "Amount matched within tolerance only",
  BANK_MISMATCH: "POP bank differs from supplier bank",
  POP_VERIFIER: "AI: a payment may have been missed — verify",
  NUMBER_FORMAT_MISMATCH: "Invoice number doesn't match this supplier's numbering",
};

export function flagLabel(code: InvoiceFlagCode) {
  return FLAG_LABEL[code];
}

function toFlagArray(raw: unknown): InvoiceFlag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is InvoiceFlag => !!f && typeof f === "object" && "code" in f);
}

export function parseFlags(raw: unknown): InvoiceFlag[] {
  return toFlagArray(raw);
}

export function activeFlags(raw: unknown): InvoiceFlag[] {
  return parseFlags(raw).filter((f) => !f.dismissed);
}

// ─── Detection at creation ──────────────────────────────────
// Returns flags to attach when a new invoice is being created. Caller passes
// the fields about to be written. Runs BEFORE the insert, so it does not see
// the new row itself.
export async function detectCreationFlags(input: {
  orderId?: string | null;
  supplierId?: string | null;
  amount: number;
  issueDate?: Date | null;
}): Promise<InvoiceFlag[]> {
  const flags: InvoiceFlag[] = [];
  const now = new Date().toISOString();

  if (input.orderId) {
    const dupByOrder = await prisma.invoice.findFirst({
      where: { orderId: input.orderId },
      select: { id: true, invoiceNumber: true, status: true },
    });
    if (dupByOrder) {
      flags.push({
        code: "DUPLICATE_PO",
        message: `Another invoice (${dupByOrder.invoiceNumber}, ${dupByOrder.status}) already exists for this PO. Review before approving.`,
        detectedAt: now,
        meta: { conflictInvoiceId: dupByOrder.id, conflictInvoiceNumber: dupByOrder.invoiceNumber },
      });
    }
  }

  return flags;
}

// ─── Detection at payment ──────────────────────────────────
// Called when an invoice transitions to PAID (or DEPOSIT_PAID) — either via
// the telegram-bot auto-matcher or manually in the backoffice UI.
export async function detectPaymentFlags(input: {
  invoiceId: string;
  paymentRef?: string | null;
  popInvoiceReference?: string | null;
  popRecipientAccount?: string | null;
  matchMethod?: "exact" | "tolerance" | null;
}): Promise<InvoiceFlag[]> {
  const flags: InvoiceFlag[] = [];
  const now = new Date().toISOString();

  if (input.paymentRef) {
    const existingRef = await prisma.invoice.findFirst({
      where: {
        paymentRef: input.paymentRef,
        NOT: { id: input.invoiceId },
      },
      select: { id: true, invoiceNumber: true, status: true, paidAt: true },
    });
    if (existingRef) {
      flags.push({
        code: "DUPLICATE_PAYMENT_REF",
        message: `Payment reference ${input.paymentRef} is already attached to invoice ${existingRef.invoiceNumber} (${existingRef.status}). Possible duplicate POP.`,
        detectedAt: now,
        meta: {
          conflictInvoiceId: existingRef.id,
          conflictInvoiceNumber: existingRef.invoiceNumber,
        },
      });
    }
  }

    // Normalised reference: strip non-alphanumerics so "#1-14306" (supplier
    // invoice) and "1-14306" (Maybank recipient ref) compare equal. Skip very
    // short refs — a bare "30" would substring-match "INV-300" and fire a
    // false double-payment flag (the bug this guard fixes).
  const refNorm = (input.popInvoiceReference ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (refNorm.length >= 4) {
    // contains() narrows candidates in SQL; the normalised token comparison
    // below is the real match so embedded-substring false positives are dropped.
    const candidates = await prisma.invoice.findMany({
      where: {
        invoiceNumber: { contains: input.popInvoiceReference!, mode: "insensitive" },
        status: "PAID",
        NOT: { id: input.invoiceId },
      },
      select: { id: true, invoiceNumber: true, paymentRef: true, paidAt: true },
    });
    const refMatch = candidates.find((c) => {
      const inv = c.invoiceNumber.replace(/[^a-z0-9]/gi, "").toLowerCase();
      // Equal, or one is a prefix-stripped form of the other (e.g. "#" dropped).
      return inv === refNorm || inv.endsWith(refNorm) || refNorm.endsWith(inv);
    });
    if (refMatch) {
      flags.push({
        code: "REF_MATCHES_PAID_INVOICE",
        message: `POP recipient reference "${input.popInvoiceReference}" matches ${refMatch.invoiceNumber}, already paid${refMatch.paidAt ? ` on ${refMatch.paidAt.toISOString().slice(0, 10)}` : ""}. Possible double payment — verify with supplier.`,
        detectedAt: now,
        meta: {
          conflictInvoiceId: refMatch.id,
          conflictInvoiceNumber: refMatch.invoiceNumber,
          conflictPaymentRef: refMatch.paymentRef,
        },
      });
    }
  }

  if (input.matchMethod === "tolerance") {
    flags.push({
      code: "AMOUNT_TOLERANCE_MATCH",
      message: `POP amount matched this invoice only within ±RM 0.50 tolerance, not exactly. Verify amounts agree.`,
      detectedAt: now,
    });
  }

  if (input.popRecipientAccount) {
    const inv = await prisma.invoice.findUnique({
      where: { id: input.invoiceId },
      select: {
        supplier: { select: { bankAccountNumber: true, name: true } },
        vendorBankAccountNumber: true,
        vendorName: true,
      },
    });
    const popDigits = input.popRecipientAccount.replace(/\D/g, "");
    const invoiceDigits = (inv?.supplier?.bankAccountNumber ?? inv?.vendorBankAccountNumber ?? "").replace(/\D/g, "");
    if (popDigits && invoiceDigits && popDigits !== invoiceDigits) {
      flags.push({
        code: "BANK_MISMATCH",
        message: `POP was paid to account ${input.popRecipientAccount}, but ${inv?.supplier?.name ?? inv?.vendorName ?? "this payee"}'s stored account is ${invoiceDigits}. Verify the recipient.`,
        detectedAt: now,
        meta: { popAccount: popDigits, storedAccount: invoiceDigits },
      });
    }
  }

  return flags;
}

// Merge new flags into an existing flags array, skipping duplicates by code.
export function mergeFlags(existing: unknown, incoming: InvoiceFlag[]): InvoiceFlag[] {
  const current = toFlagArray(existing);
  const have = new Set(current.filter((f) => !f.dismissed).map((f) => f.code));
  const toAdd = incoming.filter((f) => !have.has(f.code));
  return [...current, ...toAdd];
}

export async function appendInvoiceFlags(invoiceId: string, incoming: InvoiceFlag[]) {
  if (incoming.length === 0) return;
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { flags: true } });
  const merged = mergeFlags(inv?.flags, incoming);
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { flags: merged as unknown as Prisma.InputJsonValue },
  });
}
