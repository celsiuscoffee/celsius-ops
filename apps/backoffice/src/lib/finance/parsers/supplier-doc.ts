// Supplier document parser — Claude vision extracts a structured bill from
// PDFs and images (camera shots from staff, supplier email attachments).
//
// Why Sonnet not Haiku: Haiku 4.5 is solid for text but loses fidelity on
// blurry phone photos and unusual layouts (handwritten notes, stamps,
// invoices in BM). Sonnet handles those reliably and the volume is low
// (tens per day, not thousands).

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const PARSER_VERSION = "supplier-doc-v1";

export type ParsedBill = {
  supplierName: string | null;
  supplierTaxId: string | null;       // SST/GST registration number if shown
  billNumber: string | null;
  billDate: string | null;            // YYYY-MM-DD
  dueDate: string | null;
  outletHint: string | null;          // delivery address line if present
  lineItems: Array<{
    description: string;
    quantity: number | null;
    unitPrice: number | null;
    amount: number;
  }>;
  subtotal: number | null;
  sst: number | null;
  total: number | null;
  currency: string;                   // default MYR
  notes: string | null;
  parseConfidence: number;            // 0-1, parser's own self-rating
  rawWarnings: string[];              // anything ambiguous to flag in exception
};

const PARSE_PROMPT = `Extract this supplier bill into the JSON schema below. Bills are from Malaysian F&B suppliers. Most are in English; some have BM ("Tarikh", "Jumlah", "Cukai"). Treat blurry digits as null rather than guessing.

# Schema
{
  "supplier_name": string | null,
  "supplier_tax_id": string | null,
  "bill_number": string | null,
  "bill_date": "YYYY-MM-DD" | null,
  "due_date": "YYYY-MM-DD" | null,
  "outlet_hint": string | null,                // delivery address city / outlet name if shown
  "line_items": [{ "description": string, "quantity": number | null, "unit_price": number | null, "amount": number }],
  "subtotal": number | null,
  "sst": number | null,
  "total": number | null,                      // gross including SST
  "currency": "MYR",
  "notes": string | null,
  "parse_confidence": 0.0-1.0,                 // your confidence in the structured extract
  "raw_warnings": [string]                     // e.g. ["bill date partially obscured", "two totals don't match"]
}

# Rules
- bill_date / due_date: convert any format (DD/MM/YYYY, "5 May 2026", "5 Mei 2026") to YYYY-MM-DD. If only month+year, use the 1st.
- supplier_tax_id: only if labelled "SST", "GST", "Tax No", "ROC", or similar — not a generic registration number.
- subtotal + sst should sum to total; if they don't, leave subtotal/sst null and set total only.
- If no SST line is shown, leave sst as null (not 0).
- If no clear delivery address / outlet, leave outlet_hint null. Don't infer.
- raw_warnings: include ANY uncertainty. The downstream agent uses this to decide whether to auto-post or flag.

Return JSON only, no prose.`;

export async function parseSupplierDoc(opts: {
  fileBytes: Buffer;
  mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
}): Promise<ParsedBill> {
  const base64 = opts.fileBytes.toString("base64");

  // Anthropic SDK accepts pdf as type:"document", images as type:"image".
  // Both go in the same content array.
  const docBlock =
    opts.mimeType === "application/pdf"
      ? ({
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: "application/pdf" as const,
            data: base64,
          },
        })
      : ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: opts.mimeType,
            data: base64,
          },
        });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          docBlock,
          { type: "text", text: PARSE_PROMPT },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return emptyParsed("Parser returned no JSON");
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    return emptyParsed("Parser returned invalid JSON");
  }

  const lineItems = Array.isArray(raw.line_items)
    ? (raw.line_items as Array<Record<string, unknown>>).map((li) => ({
        description: String(li.description ?? ""),
        quantity: numOrNull(li.quantity),
        unitPrice: numOrNull(li.unit_price),
        amount: Number(li.amount ?? 0),
      }))
    : [];

  return {
    supplierName: strOrNull(raw.supplier_name),
    supplierTaxId: strOrNull(raw.supplier_tax_id),
    billNumber: strOrNull(raw.bill_number),
    billDate: strOrNull(raw.bill_date),
    dueDate: strOrNull(raw.due_date),
    outletHint: strOrNull(raw.outlet_hint),
    lineItems,
    subtotal: numOrNull(raw.subtotal),
    sst: numOrNull(raw.sst),
    total: numOrNull(raw.total),
    currency: typeof raw.currency === "string" ? raw.currency : "MYR",
    notes: strOrNull(raw.notes),
    parseConfidence: clamp01(Number(raw.parse_confidence) || 0),
    rawWarnings: Array.isArray(raw.raw_warnings) ? (raw.raw_warnings as string[]) : [],
  };
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" || t.toLowerCase() === "null" ? null : t;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function emptyParsed(warning: string): ParsedBill {
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
    rawWarnings: [warning],
  };
}
