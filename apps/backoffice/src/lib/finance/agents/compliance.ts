// Compliance Agent — submits e-invoices to LHDN MyInvois.
//
// Two flows:
//
// 1. B2C consolidated (default for retail POS sales)
//    Once a month, group all retail invoices that don't have an explicit
//    customer TIN into ONE consolidated e-invoice per outlet. Submit it as
//    a single document with line items aggregated by SKU/category.
//
// 2. B2B per-invoice (GastroHub vendors, meetings & events with a
//    business buyer)
//    Submit each fin_invoice individually with the buyer's TIN.
//
// Output for both flows lands in fin_einvoice_submissions with the LHDN
// UUID, status, and any rejection reasons. The UI surface only sees status
// transitions; raw LHDN payloads are kept in raw_response for audit.

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "../supabase";
import {
  isEnabled as myinvoisEnabled,
  submitDocuments,
  type EinvoiceDocument,
  type SubmissionResult,
} from "../myinvois/client";

export const COMPLIANCE_AGENT_VERSION = "compliance-v1";

const GENERAL_PUBLIC_TIN = "EI00000000010";   // LHDN-reserved generic buyer TIN

type SupplierProfile = {
  tin: string;
  brn: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: "MYS";
  msicCode: string;
  contactNumber: string;
  sstRegistration?: string;
};

async function getSupplierProfile(companyId: string): Promise<SupplierProfile> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_companies")
    .select("name, legal_name, brn, tin, sst_registration, msic_code, address_line1, address_line2, city, state, contact_phone")
    .eq("id", companyId)
    .maybeSingle();

  // Per-company config wins; env vars are a last-resort fallback for orgs
  // that haven't filled in the company settings yet.
  return {
    tin: (data?.tin as string) ?? process.env.MYINVOIS_TIN ?? "",
    brn: (data?.brn as string) ?? process.env.MYINVOIS_BRN ?? "",
    name: (data?.legal_name as string) ?? (data?.name as string) ?? process.env.MYINVOIS_SUPPLIER_NAME ?? "Celsius Coffee Sdn Bhd",
    address: [data?.address_line1, data?.address_line2].filter(Boolean).join(", ") || process.env.MYINVOIS_SUPPLIER_ADDRESS || "",
    city: (data?.city as string) ?? process.env.MYINVOIS_SUPPLIER_CITY ?? "Kuala Lumpur",
    state: (data?.state as string) ?? process.env.MYINVOIS_SUPPLIER_STATE ?? "WP Kuala Lumpur",
    country: "MYS",
    msicCode: (data?.msic_code as string) ?? process.env.MYINVOIS_MSIC ?? "56101",
    contactNumber: (data?.contact_phone as string) ?? process.env.MYINVOIS_CONTACT ?? "",
    sstRegistration: (data?.sst_registration as string) ?? process.env.MYINVOIS_SST_REG,
  };
}

// Build a consolidated B2C e-invoice document for one outlet for one month.
// Aggregates all retail (non-B2B) invoices into a single document per
// LHDN's consolidated-invoice rules.
async function buildConsolidatedDoc(opts: {
  companyId: string;
  yearMonth: string;
  outletId: string;
}): Promise<EinvoiceDocument | null> {
  const client = getFinanceClient();
  const { companyId, yearMonth, outletId } = opts;
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

  const { data: invoices } = await client
    .from("fin_invoices")
    .select("id, invoice_number, channel, invoice_date, subtotal, sst_amount, total, customer_id")
    .eq("company_id", companyId)
    .eq("outlet_id", outletId)
    .is("customer_id", null)              // B2C only — those without a customer record
    .gte("invoice_date", start)
    .lte("invoice_date", end);

  if (!invoices || invoices.length === 0) return null;

  // Skip any invoice already individually submitted (defensive).
  const ids = invoices.map((i) => i.id as string);
  const { data: existing } = await client
    .from("fin_einvoice_submissions")
    .select("invoice_id")
    .in("invoice_id", ids);
  const submittedIds = new Set((existing ?? []).map((e) => e.invoice_id as string));
  const unsubmitted = invoices.filter((i) => !submittedIds.has(i.id as string));
  if (unsubmitted.length === 0) return null;

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { name: true, code: true },
  });

  const subtotal = unsubmitted.reduce((s, i) => s + Number(i.subtotal), 0);
  const sstTotal = unsubmitted.reduce((s, i) => s + Number(i.sst_amount), 0);
  const total = unsubmitted.reduce((s, i) => s + Number(i.total), 0);

  // One aggregated line per channel — readable + matches POS structure.
  const byChannel = new Map<string, { subtotal: number; sst: number; count: number }>();
  for (const i of unsubmitted) {
    const ch = (i.channel as string) ?? "other";
    const cur = byChannel.get(ch) ?? { subtotal: 0, sst: 0, count: 0 };
    cur.subtotal += Number(i.subtotal);
    cur.sst += Number(i.sst_amount);
    cur.count += 1;
    byChannel.set(ch, cur);
  }

  const lineItems = Array.from(byChannel.entries()).map(([channel, agg]) => ({
    description: `Retail ${channel} sales — ${unsubmitted.length} transactions, ${outlet?.name ?? outletId}`,
    quantity: agg.count,
    unitPrice: round2(agg.subtotal / Math.max(agg.count, 1)),
    classification: "022",       // F&B service classification
    subtotal: round2(agg.subtotal),
    sstRate: 0.06,
    sstAmount: round2(agg.sst),
  }));

  const supplier = await getSupplierProfile(companyId);

  return {
    documentType: "01",
    documentVersion: "1.0",
    issueDate: new Date().toISOString(),
    invoiceNumber: `CONS-${outlet?.code ?? outletId}-${yearMonth}`,
    currency: "MYR",
    supplier,
    buyer: {
      tin: GENERAL_PUBLIC_TIN,
      name: "General Public",
      address: "Malaysia",
      contactNumber: "0000000000",
    },
    lineItems,
    legalMonetaryTotal: {
      lineExtensionAmount: round2(subtotal),
      taxExclusiveAmount: round2(subtotal),
      taxInclusiveAmount: round2(total),
      payableAmount: round2(total),
    },
    taxTotal: { taxAmount: round2(sstTotal) },
  };
}

export type SubmitConsolidatedResult = {
  yearMonth: string;
  outlets: Array<{
    outletId: string;
    outletName: string;
    docNumber?: string;
    submission?: SubmissionResult;
    submissionId?: string;
    skipped?: string;
  }>;
};

// Run the monthly consolidated B2C e-invoice cycle. Loops every active
// outlet that belongs to this company, builds the document, submits to
// LHDN, persists results.
export async function submitConsolidatedMonth(
  companyId: string,
  yearMonth: string,
  actor: string
): Promise<SubmitConsolidatedResult> {
  if (!myinvoisEnabled()) {
    throw new Error("MyInvois is not configured. Set MYINVOIS_* env vars first.");
  }
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error(`Invalid yearMonth: ${yearMonth}`);
  }

  const client = getFinanceClient();
  await client.rpc("fin_set_actor", { p_actor: actor });

  // Only loop outlets belonging to this company.
  const { data: mappings } = await client
    .from("fin_outlet_companies")
    .select("outlet_id")
    .eq("company_id", companyId);
  const ownedOutletIds = (mappings ?? []).map((m) => m.outlet_id as string);
  if (ownedOutletIds.length === 0) {
    return { yearMonth, outlets: [] };
  }
  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", id: { in: ownedOutletIds } },
    select: { id: true, name: true, code: true },
  });

  const result: SubmitConsolidatedResult = { yearMonth, outlets: [] };

  for (const outlet of outlets) {
    const doc = await buildConsolidatedDoc({ companyId, yearMonth, outletId: outlet.id });
    if (!doc) {
      result.outlets.push({
        outletId: outlet.id,
        outletName: outlet.name,
        skipped: "no unsubmitted B2C invoices",
      });
      continue;
    }

    let submission: SubmissionResult;
    try {
      const submissions = await submitDocuments([doc]);
      submission = submissions[0];
    } catch (err) {
      result.outlets.push({
        outletId: outlet.id,
        outletName: outlet.name,
        docNumber: doc.invoiceNumber,
        skipped: `LHDN error: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Persist a submission row referencing every invoice the consolidated
    // document covered.
    const [yearStr, monthStr] = yearMonth.split("-");
    const start = `${Number(yearStr)}-${String(Number(monthStr)).padStart(2, "0")}-01`;
    const endDay = new Date(Number(yearStr), Number(monthStr), 0).getDate();
    const end = `${Number(yearStr)}-${String(Number(monthStr)).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

    const { data: invoices } = await client
      .from("fin_invoices")
      .select("id")
      .eq("company_id", companyId)
      .eq("outlet_id", outlet.id)
      .is("customer_id", null)
      .gte("invoice_date", start)
      .lte("invoice_date", end);

    for (const inv of invoices ?? []) {
      await client.from("fin_einvoice_submissions").insert({
        id: randomUUID(),
        invoice_id: inv.id as string,
        myinvois_uuid: submission.uuid ?? null,
        submission_id: submission.submissionId ?? null,
        status: submission.ok ? "submitted" : "rejected",
        validation_results: submission.rejectionReasons ?? null,
        submitted_at: submission.ok ? new Date().toISOString() : null,
        raw_response: (submission.raw as object) ?? null,
      });
    }

    result.outlets.push({
      outletId: outlet.id,
      outletName: outlet.name,
      docNumber: doc.invoiceNumber,
      submission,
      submissionId: submission.submissionId,
    });
  }

  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
