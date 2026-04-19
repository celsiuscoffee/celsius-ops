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
  // Outlet name identified on the invoice (billed-to / ship-to / delivery
  // address). Matches one of the provided outletNames when possible.
  outletName: string | null;
  items: ExtractedItem[];
  deliveryCharge: number | null;
  notes: string | null;
  // Bank details printed on the invoice (for one-off vendors that
  // don't have a Supplier record — finance transfers using these).
  vendorBankName: string | null;
  vendorBankAccountNumber: string | null;
  vendorBankAccountName: string | null;
  confidence: "high" | "medium" | "low";
  rawText: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { urls, context, productNames, supplierNames, orderItems, outletNames } = body as { urls: string[]; context?: string; productNames?: string[]; supplierNames?: string[]; orderItems?: string[]; outletNames?: string[] };

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
${supplierNames?.length ? `\nKNOWN SUPPLIERS:\n${supplierNames.join("\n")}\n\nFor "supplierName": if the vendor on the invoice matches a KNOWN SUPPLIER, use the EXACT supplier name from this list. If it does NOT match any known supplier (one-off vendor — common for asset/maintenance invoices like cleaning, plumbing, electronics), return the vendor name as printed on the invoice (typically in the "INVOICE FROM" or header area). Never return null just because it's not in the known list.` : ""}
${outletNames?.length ? `\nKNOWN OUTLETS:\n${outletNames.join("\n")}\n\nFor "outletName": identify which Celsius Coffee outlet the invoice relates to. Rules:
1. Check the "Bill To", "Ship To", "Deliver To", or address block on the invoice.
2. Match using LOCATION KEYWORDS in the address, not just the outlet name. Examples: "Putrajaya" in the address → match outlet with "Putrajaya" in its name; "Shah Alam" → match "Shah Alam"; "Conezion" / "IOI" → usually Putrajaya; "Tamarind" / "Gamuda" → Tamarind outlet.
3. Bill-to may be a personal staff name (e.g. "En Syafiq") rather than an outlet name — in that case match by the ADDRESS keywords.
4. If multiple outlets could match, prefer the one whose name keyword appears most specifically in the address.
5. Return the EXACT outlet name from the list above. If no clear match, return null — never guess blindly.` : ""}
${productNames?.length ? `\nKNOWN PRODUCT CATALOG (use these exact names when matching items on the invoice):\n${productNames.join("\n")}\n\nIMPORTANT MATCHING RULES:
1. Match each invoice line item to the CLOSEST product from the catalog. Products may have different names on the invoice vs catalog (e.g. "Celsius Blend" = "Home Blend (Collective)", brand names may differ from product names).
2. Use the EXACT catalog name (without the SKU in brackets) in the "name" field.
3. ONLY include items that match a product in the catalog. Do NOT include items that have no catalog match.
4. Delivery charges, shipping fees, service charges, discounts, and similar non-product charges should NOT be in the items array — put them in "deliveryCharge" or "notes" instead.` : ""}
${orderItems?.length ? `\nCURRENT ORDER ITEMS (these are what was ordered — use this to understand the expected packaging and pricing):
${orderItems.join("\n")}

PACKAGING & PRICING LOGIC:
- Suppliers may invoice using different packaging units than what the order uses (e.g. invoice says "carton" but order tracks per "bottle").
- The product catalog above shows available packages with conversion factors [×N] and known prices per package.
- Use the ORDER ITEMS above to determine the correct unit price and quantity to return.
- If the invoice unit price matches a DIFFERENT package than what the order uses, convert accordingly:
  Example: Order is per "bottle" at RM14.08. Invoice shows 6x at RM84.46/carton. Carton [×6] means 6 bottles per carton. Return: quantity=36 (6 cartons × 6 bottles), unitPrice=14.08 (per bottle).
- If the invoice unit price matches the order's unit price, use it directly without conversion.
- Always return quantity and unitPrice in the SAME unit as the order item's package.` : ""}

Return a JSON object with these fields:
- invoiceNumber: the invoice/receipt number (string or null)
- dueDate: payment due date in YYYY-MM-DD format (string or null)
- issueDate: invoice issue/purchase date in YYYY-MM-DD format (string or null)
- deliveryDate: delivery/shipping date in YYYY-MM-DD format (string or null). If not found, use issueDate.
- amount: total amount as a number (number or null). Only the final total, not subtotals.
- supplierName: the vendor/supplier/company name (string or null)
- outletName: the Celsius Coffee outlet/branch on the invoice (string or null). Match to one of the KNOWN OUTLETS above if provided; return the exact name. Only set this when the invoice clearly identifies a specific branch — never guess.
- items: array of line items, each with { name: string, quantity: number, unitPrice: number, totalPrice: number, uom: string|null }. ONLY include items that match the product catalog. uom = unit of measure (e.g. "pcs", "kg", "pack", "carton").
- deliveryCharge: delivery/shipping fee as a number (number or null)
- notes: any relevant notes like payment terms, bank details summary (string or null)
- vendorBankName: the bank name printed on the invoice for payment (e.g. "Maybank", "CIMB", "Public Bank"). String or null. Invoices for one-off vendors / asset purchases / maintenance often print "Please transfer to:" followed by bank details — extract them here.
- vendorBankAccountNumber: the account number printed on the invoice, digits only (strip spaces/dashes). String or null.
- vendorBankAccountName: the account holder name printed on the invoice, typically all-caps. String or null.
- confidence: "high" if all key fields are clearly readable, "medium" if some fields are ambiguous, "low" if document is unclear

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation. If a field is not found, use null. For items, return empty array [] if no line items found. For bank fields, extract only if the invoice clearly prints bank/account info — never guess or infer.`,
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
        outletName: null,
        items: [],
        deliveryCharge: null,
        notes: null,
        vendorBankName: null,
        vendorBankAccountNumber: null,
        vendorBankAccountName: null,
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
