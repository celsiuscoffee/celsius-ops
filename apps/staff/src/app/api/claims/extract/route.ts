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

type ExtractedReceipt = {
  invoiceNumber: string | null;
  issueDate: string | null; // YYYY-MM-DD
  amount: number | null;
  supplierName: string | null;
  items: ExtractedItem[];
  confidence: "high" | "medium" | "low";
  notes: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls } = body as { urls: string[] };

    if (!urls?.length) {
      return NextResponse.json({ error: "No URLs provided" }, { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 }
      );
    }

    // Build content blocks — images get sent as image URLs, PDFs as base64 document
    const contentBlocks: Anthropic.ContentBlockParam[] = [];

    for (const url of urls) {
      const isPdf = /\.pdf($|\?)/i.test(url) || url.includes("/raw/");

      if (isPdf) {
        try {
          const pdfRes = await fetch(url);
          if (pdfRes.ok) {
            const buffer = await pdfRes.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            contentBlocks.push({
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            } as Anthropic.ContentBlockParam);
          }
        } catch {
          // Skip failed PDF fetches
        }
      } else {
        contentBlocks.push({
          type: "image",
          source: { type: "url", url },
        });
      }
    }

    if (contentBlocks.length === 0) {
      return NextResponse.json(
        { error: "No valid files to process" },
        { status: 400 }
      );
    }

    contentBlocks.push({
      type: "text",
      text: `Extract receipt/invoice details from the uploaded document(s). This is a staff pay & claim receipt from a Malaysian F&B business.

Return a JSON object with these fields:
- invoiceNumber: the invoice/receipt number (string or null)
- issueDate: purchase/issue date in YYYY-MM-DD format (string or null)
- amount: total amount in MYR as a number (number or null). Only the final total, not subtotals.
- supplierName: the vendor/supplier name (string or null)
- items: array of line items found on the receipt. Each item: { name: string, quantity: number, unitPrice: number, totalPrice: number, uom: string|null }. Extract ALL products/items listed. uom = unit of measure (e.g. "pcs", "kg", "pack", "carton", "box"). If no line items found, return empty array [].
- notes: any relevant notes like payment method (string or null)
- confidence: "high" if all key fields are clearly readable, "medium" if some fields are ambiguous, "low" if document is unclear

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation. If a field is not found, use null.`,
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

    let extracted: ExtractedReceipt;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
    } catch {
      extracted = {
        invoiceNumber: null,
        issueDate: null,
        amount: null,
        supplierName: null,
        items: [],
        confidence: "low",
        notes: text,
      };
    }

    return NextResponse.json(extracted);
  } catch (err) {
    console.error("[claims/extract POST]", err);
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
