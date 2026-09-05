// Duplicate-invoice guard — the one check every invoice-creating path calls.
//
// Why: the per-supplier @@unique(supplierId, invoiceNumber) only catches an
// exact repeat. In production the same bill was paid twice under "12427" /
// "12427a", "26-0644" / "260644", "A-9O6…" / "A9O6…", and under different
// numbers but identical supplier+amount days apart. This module normalises the
// number (case, punctuation, a single trailing re-claim letter) and also looks
// for a same-supplier same-amount invoice inside a window, so a second entry
// is refused with 409 DUPLICATE_INVOICE unless the caller explicitly overrides
// (the UI shows the match and asks "record anyway?").
//
// Read-only helper: it never writes. Callers decide what to do with `match`.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const DUPLICATE_WINDOW_DAYS = 14;

/** Canonical form for comparing invoice numbers across sloppy re-keying. */
export function normalizeInvoiceNumber(n: string | null | undefined): string {
  if (!n) return "";
  return n.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Strip ONE trailing letter when the rest is numeric-heavy ("12427a" → "12427",
 * "731175A" → "731175"). Returns null when there is nothing to strip, so the
 * caller can tell a suffix variant from an exact repeat.
 */
export function stripReclaimSuffix(normalized: string): string | null {
  const m = /^([a-z0-9]*\d)([a-z])$/.exec(normalized);
  return m ? m[1] : null;
}

export type DuplicateMatch = {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  amount: number;
  issueDate: string;
  reason: "same_number" | "suffix_variant" | "same_amount_window";
};

export type DedupeInput = {
  supplierId?: string | null;
  invoiceNumber?: string | null;
  amount?: number | null;
  issueDate?: Date | null;
  /** When editing, ignore the row being edited. */
  excludeInvoiceId?: string | null;
};

/**
 * Find an existing invoice for the same supplier that is probably the same
 * bill. Supplier is resolved from Invoice.supplierId OR the linked order's
 * supplier, because historical rows only carry one of the two.
 */
export async function findDuplicateInvoice(input: DedupeInput): Promise<DuplicateMatch | null> {
  const supplierId = input.supplierId ?? null;
  if (!supplierId) return null; // ad-hoc rows without a supplier can't be compared

  const norm = normalizeInvoiceNumber(input.invoiceNumber);
  const stem = stripReclaimSuffix(norm);
  const amount = input.amount != null && Number.isFinite(input.amount) ? Number(input.amount) : null;
  const around = input.issueDate ?? new Date();
  const from = new Date(around.getTime() - DUPLICATE_WINDOW_DAYS * 86_400_000);
  const to = new Date(around.getTime() + DUPLICATE_WINDOW_DAYS * 86_400_000);

  const rows = await prisma.$queryRaw<
    Array<{ id: string; invoiceNumber: string; status: string; amount: number; issueDate: Date; norm: string }>
  >`
    SELECT i.id, i."invoiceNumber", i.status::text AS status, i.amount::float AS amount, i."issueDate",
           lower(regexp_replace(i."invoiceNumber", '[^A-Za-z0-9]', '', 'g')) AS norm
    FROM "Invoice" i
    LEFT JOIN "Order" o ON o.id = i."orderId"
    WHERE COALESCE(i."supplierId", o."supplierId") = ${supplierId}
      AND (${input.excludeInvoiceId ?? ""} = '' OR i.id <> ${input.excludeInvoiceId ?? ""})
      AND (
        (${norm} <> '' AND lower(regexp_replace(i."invoiceNumber", '[^A-Za-z0-9]', '', 'g')) = ${norm})
        OR (${stem ?? ""} <> '' AND lower(regexp_replace(i."invoiceNumber", '[^A-Za-z0-9]', '', 'g')) = ${stem ?? ""})
        OR (${norm} <> '' AND regexp_replace(lower(regexp_replace(i."invoiceNumber", '[^A-Za-z0-9]', '', 'g')), '([0-9])[a-z]$', '\\1') = ${norm})
        OR (${amount ?? -1}::numeric > 0
            AND abs(i.amount - ${amount ?? -1}::numeric) < 0.01
            AND i."issueDate" BETWEEN ${from} AND ${to})
      )
    ORDER BY i."issueDate" DESC
    LIMIT 5`;

  if (rows.length === 0) return null;

  const pick = (reason: DuplicateMatch["reason"], r: (typeof rows)[number]): DuplicateMatch => ({
    invoiceId: r.id,
    invoiceNumber: r.invoiceNumber,
    status: r.status,
    amount: Number(r.amount),
    issueDate: r.issueDate.toISOString().slice(0, 10),
    reason,
  });

  const exact = rows.find((r) => norm && r.norm === norm);
  if (exact) return pick("same_number", exact);
  const variant = rows.find(
    (r) => (stem && r.norm === stem) || (norm && stripReclaimSuffix(r.norm) === norm),
  );
  if (variant) return pick("suffix_variant", variant);
  return pick("same_amount_window", rows[0]);
}

export type DedupeGuardResult =
  | { ok: true; match: DuplicateMatch | null }
  | { ok: false; match: DuplicateMatch; response: NextResponse };

/**
 * Route-level guard. Refuses with 409 unless `override` is true; an
 * overridden match is still returned so the caller can flag the row.
 */
export async function assertNoDuplicateInvoice(
  input: DedupeInput,
  opts?: { override?: boolean },
): Promise<DedupeGuardResult> {
  const match = await findDuplicateInvoice(input);
  if (!match) return { ok: true, match: null };
  if (opts?.override) return { ok: true, match };
  const why =
    match.reason === "same_number"
      ? "the same invoice number"
      : match.reason === "suffix_variant"
        ? `a variant of the same number (${match.invoiceNumber})`
        : `the same amount within ${DUPLICATE_WINDOW_DAYS} days (${match.invoiceNumber})`;
  return {
    ok: false,
    match,
    response: NextResponse.json(
      {
        error: `Possible duplicate: this supplier already has an invoice with ${why} — RM ${match.amount.toFixed(2)}, ${match.status}, dated ${match.issueDate}. Check before recording it again.`,
        code: "DUPLICATE_INVOICE",
        match,
      },
      { status: 409 },
    ),
  };
}
