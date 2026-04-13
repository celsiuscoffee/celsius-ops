import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ExtractedItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  uom: string | null;
};

type ExtractedInvoice = {
  invoiceNumber: string | null;
  dueDate: string | null; // YYYY-MM-DD
  issueDate: string | null; // YYYY-MM-DD
  deliveryDate: string | null; // YYYY-MM-DD
  amount: number | null;
  supplierName: string | null;
  items: ExtractedItem[];
  notes: string | null;
  confidence: "high" | "medium" | "low";
  rawText: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, context, productNames, supplierNames } = body as { urls: string[]; context?: string; productNames?: string[]; supplierNames?: string[] };

    if (!urls?.length) {
      return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    // Build content blocks — images get sent as image URLs, PDFs as text description
    const contentBlocks: Anthropic.ContentBlockParam[] = [];

    for (const url of urls) {
      const isPdf = /\.pdf($|\?)/i.test(url) || url.includes("/raw/");

      if (isPdf) {
        // For PDFs, fetch and send as base64 document
        try {
          const pdfRes = await fetch(url);
          if (pdfRes.ok) {
            const buffer = await pdfRes.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            contentBlocks.push({
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            } as Anthropic.ContentBlockParam);
          }
        } catch {
          // Skip failed PDF fetches
        }
      } else {
        // For images, send as image URL
        contentBlocks.push({
          type: "image",
          source: { type: "url", url },
        });
      }
    }

    if (contentBlocks.length === 0) {
      return NextResponse.json({ error: "No valid files to process" }, { status: 400 });
    }

    contentBlocks.push({
      type: "text",
      text: `Extract invoice/receipt details from the uploaded document(s). ${context ? `Context: ${context}` : ""}
${supplierNames?.length ? `\nKNOWN SUPPLIERS:\n${supplierNames.join("\n")}\n\nMatch the supplier/vendor name on the invoice to one of these known suppliers. Use the EXACT supplier name from this list in the "supplierName" field.` : ""}
${productNames?.length ? `\nKNOWN PRODUCT CATALOG (use these exact names when matching items on the invoice):\n${productNames.join("\n")}\n\nWhen extracting items, match each line item to the closest product name from the catalog above. Use the EXACT catalog name (without the SKU in brackets) in the "name" field. If no close match exists, use the name as written on the invoice.` : ""}

Return a JSON object with these fields:
- invoiceNumber: the invoice/receipt number (string or null)
- dueDate: payment due date in YYYY-MM-DD format (string or null)
- issueDate: invoice issue/purchase date in YYYY-MM-DD format (string or null)
- deliveryDate: delivery/shipping date in YYYY-MM-DD format (string or null). If not found, use issueDate.
- amount: total amount as a number (number or null). Only the final total, not subtotals.
- supplierName: the vendor/supplier/company name (string or null)
- items: array of line items, each with { name: string, quantity: number, unitPrice: number, totalPrice: number, uom: string|null }. Extract ALL products/items listed on the invoice. uom = unit of measure (e.g. "pcs", "kg", "pack", "carton").
- notes: any relevant notes like payment terms, bank details summary (string or null)
- confidence: "high" if all key fields are clearly readable, "medium" if some fields are ambiguous, "low" if document is unclear

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation. If a field is not found, use null. For items, return empty array [] if no line items found.`,
    });

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: contentBlocks }],
    });

    // Parse the response
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let extracted: ExtractedInvoice;
    try {
      // Try to parse JSON from the response, handling potential markdown wrapping
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      extracted = {
        invoiceNumber: null,
        dueDate: null,
        issueDate: null,
        deliveryDate: null,
        amount: null,
        supplierName: null,
        items: [],
        notes: null,
        confidence: "low",
        rawText: text,
      };
    }

    return NextResponse.json(extracted);
  } catch (err) {
    console.error("[extract POST]", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
