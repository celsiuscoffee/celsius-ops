/**
 * Sync invoices for an account.
 *
 * For each billing period (calendar month) in the range:
 *   - Calls customer.invoices.list for that month.
 *   - Downloads the PDF to Supabase Storage (bucket: ads-invoices).
 *   - Computes SHA256 + size for audit integrity.
 *   - Upserts into ads_invoice.
 *
 * Google's invoice PDF URL is short-lived, so we must download immediately.
 */

import { prisma } from "@/lib/prisma";
import { getCustomer } from "./client";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";

const INVOICE_BUCKET = "ads-invoices";

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function downloadPdf(pdfUrl: string): Promise<Buffer> {
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`Failed to download invoice PDF (${res.status})`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function monthsBetween(fromYYYYMM: string, toYYYYMM: string): string[] {
  const [fy, fm] = fromYYYYMM.split("-").map(Number);
  const [ty, tm] = toYYYYMM.split("-").map(Number);
  const out: string[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

export async function syncInvoices(
  accountId: string,
  customerId: string,
  fromYearMonth: string, // "2026-01"
  toYearMonth: string,   // "2026-04"
): Promise<{ rows: number }> {
  const customer = getCustomer(customerId);
  const storage = getStorageClient();
  let written = 0;

  for (const ym of monthsBetween(fromYearMonth, toYearMonth)) {
    const [year, month] = ym.split("-");
    let invoices: Array<Record<string, unknown>> = [];

    try {
      // `customer.invoices.list` — billing_setup-scoped in older APIs, but the
      // google-ads-api package exposes a helper. Pass year + month (number) + billingSetupId
      // resolved automatically for the customer.
      const res = await customer.query(`
        SELECT
          invoice.id,
          invoice.type,
          invoice.billing_setup,
          invoice.issue_date,
          invoice.due_date,
          invoice.service_date_range.start_date,
          invoice.service_date_range.end_date,
          invoice.currency_code,
          invoice.subtotal_amount_micros,
          invoice.adjustments_subtotal_amount_micros,
          invoice.regulatory_costs_subtotal_amount_micros,
          invoice.total_amount_micros,
          invoice.pdf_url
        FROM invoice
        WHERE invoice.issue_date BETWEEN '${year}-${month}-01' AND '${year}-${month}-31'
      `);
      invoices = res as Array<Record<string, unknown>>;
    } catch (err) {
      // Many accounts don't have invoices through GAQL; skip silently per month.
      continue;
    }

    for (const row of invoices) {
      const inv = (row as { invoice?: Record<string, unknown> }).invoice;
      if (!inv?.id) continue;
      const invoiceId = String(inv.id);

      const issueDateStr = inv.issue_date as string | undefined;
      const dueDateStr = inv.due_date as string | undefined;
      const serviceRange = inv.service_date_range as { start_date?: string; end_date?: string } | undefined;

      if (!issueDateStr || !serviceRange?.start_date || !serviceRange?.end_date) continue;

      const totalMicros = BigInt((inv.total_amount_micros as number) ?? 0);
      const subtotalMicros = BigInt((inv.subtotal_amount_micros as number) ?? 0);
      const adjustmentsMicros = BigInt((inv.adjustments_subtotal_amount_micros as number) ?? 0);
      const regulatoryMicros = BigInt((inv.regulatory_costs_subtotal_amount_micros as number) ?? 0);
      const taxMicros = totalMicros - subtotalMicros - adjustmentsMicros - regulatoryMicros;

      // Download + upload PDF if URL available
      let storagePath: string | null = null;
      let pdfHash: string | null = null;
      let pdfSize: number | null = null;
      const pdfUrl = inv.pdf_url as string | undefined;
      if (pdfUrl) {
        try {
          const buf = await downloadPdf(pdfUrl);
          pdfSize = buf.length;
          pdfHash = createHash("sha256").update(buf).digest("hex");
          storagePath = `${customerId}/${ym}/${invoiceId}.pdf`;
          await storage.storage
            .from(INVOICE_BUCKET)
            .upload(storagePath, buf, {
              contentType: "application/pdf",
              upsert: true,
            });
        } catch (err) {
          console.error(`[ads] invoice ${invoiceId} PDF download failed:`, err);
        }
      }

      const existing = await prisma.adsInvoice.findUnique({ where: { invoiceId } });
      const data = {
        accountId,
        issueDate: new Date(issueDateStr + "T00:00:00Z"),
        dueDate: dueDateStr ? new Date(dueDateStr + "T00:00:00Z") : null,
        billingPeriodStart: new Date(serviceRange.start_date + "T00:00:00Z"),
        billingPeriodEnd: new Date(serviceRange.end_date + "T00:00:00Z"),
        currencyCode: (inv.currency_code as string) ?? "MYR",
        subtotalMicros,
        adjustmentsMicros,
        regulatoryCostsMicros: regulatoryMicros,
        taxMicros: taxMicros > BigInt(0) ? taxMicros : BigInt(0),
        totalMicros,
        status: String((inv.type as string) ?? "UNKNOWN"),
        pdfSourceUrl: pdfUrl ?? null,
        pdfStoragePath: storagePath,
        pdfHashSha256: pdfHash,
        pdfSizeBytes: pdfSize,
        syncedAt: new Date(),
      };

      if (existing) {
        await prisma.adsInvoice.update({ where: { id: existing.id }, data });
      } else {
        await prisma.adsInvoice.create({
          data: { id: randomUUID(), invoiceId, ...data },
        });
      }
      written++;
    }
  }

  return { rows: written };
}
