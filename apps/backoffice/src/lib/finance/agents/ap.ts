// AP Agent — orchestrates supplier-doc → bill journal pipeline.
//
// 1. Parse the document (Claude vision) → structured bill
// 2. Resolve supplier (existing Supplier or queue for human creation)
// 3. Duplicate check (same supplier + bill_number already in fin_bills)
// 4. Categorize (Claude → account code with confidence)
// 5. If parse + categorize confidence >= 0.85 AND total resolved AND no
//    duplicate AND no warnings: post journal + create fin_bills
//    Otherwise: create fin_exceptions for human resolution
//
// Auto-posted journal shape (single-outlet bill):
//   DR <category code>          [outlet_id]   subtotal
//   DR 3002 SST output deferred (only if sst > 0 — actually credit is to
//      SST INPUT account; for v1 we expense-side as 6513 SST Expense if
//      not registered for input claim, or to 3003 SST Deferred for input.
//      Celsius is SST-registered so input SST is recoverable: book to
//      3003 Deferred until claimed in SST-02.)
//   CR 3001 Accounts Payable    [supplier]    total

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "../supabase";
import { postJournal } from "../ledger";
import { categorize } from "./categorizer";
import { parseSupplierDoc, type ParsedBill } from "../parsers/supplier-doc";
import { resolveCompanyFromOutlet, getDefaultCompanyId } from "../companies";
import type { JournalLineInput } from "../types";

export const AP_AGENT_VERSION = "ap-v1";

export type ApIngestInput = {
  fileBytes: Buffer;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  storageUrl: string;            // supabase storage path; persisted on fin_documents
  uploadedById: string;          // User.id who uploaded (or "telegram-bot" etc.)
  outletIdHint?: string | null;  // user can pre-tag outlet at upload time
  companyIdHint?: string | null; // user-selected company (overrides outlet→company resolution)
};

export type ApIngestResult =
  | { kind: "posted"; transactionId: string; billId: string; total: number }
  | { kind: "exception"; exceptionId: string; reason: string; parsed: ParsedBill };

const AUTO_POST_THRESHOLD = 0.85;

export async function ingestSupplierDoc(input: ApIngestInput): Promise<ApIngestResult> {
  const client = getFinanceClient();

  // Resolve company from explicit hint > outlet mapping > default. Bills
  // sometimes arrive without an outlet (HQ-level: insurance, audit fees) —
  // those land on the default company unless the upload UI pre-selected one.
  const companyId =
    input.companyIdHint ??
    (input.outletIdHint ? await resolveCompanyFromOutlet(input.outletIdHint) : null) ??
    (await getDefaultCompanyId());

  // 1. Persist source doc first so anything we do downstream traces back.
  const docId = randomUUID();
  const sourceRef = `upload-${docId}`;
  await client.from("fin_documents").insert({
    id: docId,
    company_id: companyId,
    source: "manual",
    source_ref: sourceRef,
    doc_type: "supplier_invoice",
    outlet_id: input.outletIdHint ?? null,
    raw_url: input.storageUrl,
    metadata: { uploadedById: input.uploadedById, mimeType: input.mimeType },
    status: "pending",
  });

  // 2. Parse
  let parsed: ParsedBill;
  try {
    parsed = await parseSupplierDoc({
      fileBytes: input.fileBytes,
      mimeType: input.mimeType,
    });
  } catch (err) {
    return await raiseException({
      companyId,
      docId,
      reason: `Parser failed: ${err instanceof Error ? err.message : String(err)}`,
      parsed: emptyParsed(),
      proposed: null,
      relatedType: "document",
      priority: "high",
    });
  }

  // 3. Hard fails — no total, no supplier, parser low confidence
  if (!parsed.total || parsed.total <= 0) {
    return await raiseException({
      companyId,
      docId,
      reason: "Could not extract a bill total",
      parsed,
      proposed: null,
      relatedType: "document",
      priority: "high",
    });
  }
  if (!parsed.supplierName) {
    return await raiseException({
      companyId,
      docId,
      reason: "Could not extract supplier name",
      parsed,
      proposed: null,
      relatedType: "document",
      priority: "high",
    });
  }

  // 4. Resolve supplier (fuzzy on name; tax_id is exact). New suppliers
  // get queued — we don't auto-create vendor records.
  const supplier = await resolveSupplier(parsed.supplierName, parsed.supplierTaxId);
  if (!supplier) {
    return await raiseException({
      companyId,
      docId,
      reason: `Unknown supplier: "${parsed.supplierName}". Add them to suppliers first.`,
      parsed,
      proposed: null,
      relatedType: "document",
      priority: "normal",
    });
  }

  // 5. Duplicate check (per-company — same supplier+bill# can occur across
  // different Sdn Bhds).
  if (parsed.billNumber) {
    const { data: dup } = await client
      .from("fin_bills")
      .select("id, total")
      .eq("company_id", companyId)
      .eq("supplier_id", supplier.id)
      .eq("bill_number", parsed.billNumber)
      .maybeSingle();
    if (dup) {
      return await raiseException({
        companyId,
        docId,
        reason: `Duplicate of existing bill (supplier=${supplier.name}, bill_number=${parsed.billNumber})`,
        parsed,
        proposed: { duplicateOfBillId: dup.id },
        relatedType: "document",
        priority: "normal",
        type: "duplicate",
      });
    }
  }

  // 6. Resolve outlet (hint > parser hint > supplier default > null)
  const outletId = await resolveOutlet(input.outletIdHint, parsed.outletHint);

  // 7. Categorize
  const cat = await categorize({
    supplierName: parsed.supplierName,
    supplierId: supplier.id,
    lineItems: parsed.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity ?? undefined,
      amount: l.amount,
    })),
    total: parsed.total,
    outletHint: outletId
      ? await resolveOutletNameById(outletId)
      : null,
    contextNotes: parsed.notes ?? undefined,
  });

  // 8. Decision: auto-post or exception
  const blockers: string[] = [];
  if (parsed.parseConfidence < AUTO_POST_THRESHOLD) {
    blockers.push(`parse confidence ${parsed.parseConfidence.toFixed(2)} < ${AUTO_POST_THRESHOLD}`);
  }
  if (cat.confidence < AUTO_POST_THRESHOLD || !cat.accountCode) {
    blockers.push(
      `categorization confidence ${cat.confidence.toFixed(2)} < ${AUTO_POST_THRESHOLD}`
    );
  }
  if (parsed.rawWarnings.length > 0) {
    blockers.push(`parser warnings: ${parsed.rawWarnings.join("; ")}`);
  }

  if (blockers.length > 0) {
    return await raiseException({
      companyId,
      docId,
      reason: blockers.join(" · "),
      parsed,
      proposed: {
        companyId,
        supplierId: supplier.id,
        supplierName: supplier.name,
        outletId,
        categorize: cat,
        bill: parsed,
      },
      relatedType: "document",
      priority: parsed.parseConfidence < 0.5 ? "high" : "normal",
    });
  }

  // 9. Auto-post: create fin_bills + journal in lockstep.
  const subtotal = parsed.subtotal ?? Math.max(parsed.total - (parsed.sst ?? 0), 0);
  const sst = parsed.sst ?? 0;
  const lines: JournalLineInput[] = [
    {
      accountCode: cat.accountCode!,
      outletId: outletId ?? null,
      debit: round2(subtotal),
      memo: `${supplier.name} — ${parsed.billNumber ?? "no bill #"}`,
    },
  ];
  if (sst > 0) {
    lines.push({
      accountCode: "3003", // SST Deferred (recoverable input tax)
      outletId: outletId ?? null,
      debit: round2(sst),
      memo: `SST input — ${supplier.name}`,
    });
  }
  lines.push({
    accountCode: "3001",
    outletId: null,           // AP not outlet-scoped
    credit: round2(parsed.total),
    memo: `${supplier.name} payable`,
  });

  const journal = await postJournal({
    companyId,
    txnDate: parsed.billDate ?? new Date().toISOString().slice(0, 10),
    description: `Bill: ${supplier.name}${parsed.billNumber ? ` #${parsed.billNumber}` : ""}`,
    txnType: "ap_bill",
    outletId: outletId ?? null,
    sourceDocId: docId,
    agent: "ap",
    agentVersion: AP_AGENT_VERSION,
    confidence: Math.min(parsed.parseConfidence, cat.confidence),
    lines,
  });

  const billId = randomUUID();
  await client.from("fin_bills").insert({
    id: billId,
    company_id: companyId,
    supplier_id: supplier.id,
    bill_number: parsed.billNumber ?? null,
    bill_date: parsed.billDate ?? new Date().toISOString().slice(0, 10),
    due_date: parsed.dueDate ?? null,
    outlet_id: outletId ?? null,
    subtotal: round2(subtotal),
    sst_amount: round2(sst),
    total: round2(parsed.total),
    payment_status: "unpaid",
    paid_amount: 0,
    transaction_id: journal.transactionId,
    source_doc_id: docId,
    notes: parsed.notes ?? null,
    scheduled_pay_date: parsed.dueDate ?? null,
  });

  await client.from("fin_documents").update({ status: "processed", ingested_at: new Date().toISOString() }).eq("id", docId);

  return { kind: "posted", transactionId: journal.transactionId, billId, total: parsed.total };
}

async function raiseException(args: {
  companyId: string;
  docId: string;
  reason: string;
  parsed: ParsedBill;
  proposed: unknown;
  relatedType: "document";
  priority: "low" | "normal" | "high" | "urgent";
  type?: "categorization" | "match" | "missing_doc" | "anomaly" | "duplicate" | "out_of_balance";
}): Promise<{ kind: "exception"; exceptionId: string; reason: string; parsed: ParsedBill }> {
  const client = getFinanceClient();
  const id = randomUUID();
  await client.from("fin_exceptions").insert({
    id,
    company_id: args.companyId,
    type: args.type ?? "categorization",
    related_type: args.relatedType,
    related_id: args.docId,
    agent: "ap",
    reason: args.reason,
    proposed_action: args.proposed ?? null,
    priority: args.priority,
    status: "open",
  });
  await client.from("fin_documents").update({ status: "exception" }).eq("id", args.docId);
  return { kind: "exception", exceptionId: id, reason: args.reason, parsed: args.parsed };
}

async function resolveSupplier(
  name: string,
  _taxId: string | null
): Promise<{ id: string; name: string } | null> {
  // Fuzzy: case-insensitive contains. Suppliers schema doesn't store tax_id
  // today; when it does we'll prefer exact tax_id match here.
  const cleaned = name.trim();
  const all = await prisma.supplier.findMany({
    select: { id: true, name: true },
    where: { name: { contains: cleaned.split(" ")[0], mode: "insensitive" } },
    take: 5,
  });
  if (all.length === 0) return null;
  // Prefer exact match (case-insensitive) over fuzzy.
  const exact = all.find((s) => s.name.toLowerCase() === cleaned.toLowerCase());
  return exact ?? all[0];
}

async function resolveOutlet(
  hint: string | null | undefined,
  parsedHint: string | null
): Promise<string | null> {
  if (hint) return hint;
  if (!parsedHint) return null;
  const candidates = await prisma.outlet.findMany({
    select: { id: true, name: true, code: true },
  });
  const lcHint = parsedHint.toLowerCase();
  const found = candidates.find(
    (o) => lcHint.includes(o.name.toLowerCase()) || lcHint.includes(o.code.toLowerCase())
  );
  return found?.id ?? null;
}

async function resolveOutletNameById(id: string): Promise<{ id: string; name: string } | null> {
  const o = await prisma.outlet.findUnique({ where: { id }, select: { id: true, name: true } });
  return o ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyParsed(): ParsedBill {
  return {
    supplierName: null,
    supplierTaxId: null,
    billNumber: null,
    billDate: null,
    dueDate: null,
    outletHint: null,
    lineItems: [],
    subtotal: null,
    sst: null,
    total: null,
    currency: "MYR",
    notes: null,
    parseConfidence: 0,
    rawWarnings: [],
  };
}
