import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import Anthropic from "@anthropic-ai/sdk";
import { audited } from "@celsius/db";
import { prisma } from "@/lib/prisma";
import { createShortLink } from "@/lib/shortlink";
import {
  sendMessage,
  sendPhoto,
  getFileUrl,
  downloadFile,
  type TelegramUpdate,
  type TelegramMessage,
} from "@/lib/telegram";

export const maxDuration = 60;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Webhook Entry Point ────────────────────────────────────

export async function POST(request: NextRequest) {
  // Verify secret token
  const secret = request.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message) return NextResponse.json({ ok: true });

  // Only process photos and documents (images/PDFs)
  const hasPhoto = message.photo && message.photo.length > 0;
  const hasDoc = message.document && /\.(pdf|jpg|jpeg|png|webp)$/i.test(message.document.file_name ?? "");

  if (!hasPhoto && !hasDoc) {
    return NextResponse.json({ ok: true });
  }

  // Process in background — respond to Telegram immediately
  after(async () => {
    try {
      await processMessage(message);
    } catch (err) {
      console.error("[telegram webhook] Processing error:", err);
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await sendMessage(message.chat.id, `⚠️ Error processing image: ${errMsg}`, message.message_id);
    }
  });

  return NextResponse.json({ ok: true });
}

// ─── Message Processing ─────────────────────────────────────

async function processMessage(message: TelegramMessage) {
  const chatId = message.chat.id;
  const msgId = message.message_id;

  // 1. Get file ID
  let fileId: string;
  let isPdf = false;
  if (message.photo && message.photo.length > 0) {
    // Use largest photo
    fileId = message.photo[message.photo.length - 1].file_id;
  } else if (message.document) {
    fileId = message.document.file_id;
    isPdf = /\.pdf$/i.test(message.document.file_name ?? "");
  } else {
    return;
  }

  // 2. Download from Telegram
  const fileUrl = await getFileUrl(fileId);
  const buffer = await downloadFile(fileUrl);

  // 3. Upload to Cloudinary
  const base64 = `data:${isPdf ? "application/pdf" : "image/jpeg"};base64,${buffer.toString("base64")}`;
  const upload = await cloudinary.uploader.upload(base64, {
    folder: "celsius-coffee/telegram-inbox",
    resource_type: isPdf ? "raw" : "image",
    // PDFs uploaded as `raw` need a .pdf public_id so Cloudinary serves them
    // with `application/pdf` (not `application/octet-stream`). Otherwise
    // browsers render the raw bytes as text. Shortlink route also guards
    // against this, but fixing it at the source avoids the proxy hop.
    ...(isPdf ? { public_id: `pop-${Date.now()}.pdf` } : {}),
    ...(isPdf ? {} : { transformation: [{ quality: "auto", fetch_format: "auto" }] }),
  });
  const cloudinaryUrl = upload.secure_url;

  // 4. Classify + Extract via Claude
  const extracted = await classifyAndExtract(cloudinaryUrl, isPdf);
  if (!extracted) {
    await sendMessage(chatId, "Could not read this document. Please try a clearer image.", msgId);
    return;
  }

  console.log("[telegram] Classified as:", extracted.documentType, JSON.stringify(extracted));

  // 5. Route to matching logic
  if (extracted.documentType === "MULTI_POP") {
    const payments = extracted.payments;
    await sendMessage(chatId, `📄 Batch POP detected — ${payments.length} payments found. Splitting...`, msgId);

    // Split multi-page PDF into individual pages stored in Supabase
    let pageUrls: string[] = [];
    if (isPdf) {
      try {
        const { splitAndUploadPdfPages } = await import("@/lib/inventory/pdf-splitter");
        pageUrls = await splitAndUploadPdfPages(buffer, `pop-${Date.now()}`);
      } catch (err) {
        console.error("[telegram] PDF split failed:", err);
      }
    }

    for (const payment of payments) {
      const popData: PopData = { documentType: "POP", ...payment };
      // Use per-page URL if available, otherwise fall back to full PDF
      let pageUrl = cloudinaryUrl;
      const pageNum = (payment as any).pageNumber;
      if (pageNum && pageUrls[pageNum - 1]) {
        pageUrl = pageUrls[pageNum - 1];
      } else if (pageUrls.length === 1) {
        pageUrl = pageUrls[0]; // Single page result
      }
      await handlePop(chatId, msgId, pageUrl, popData);
    }
  } else if (extracted.documentType === "POP") {
    await handlePop(chatId, msgId, cloudinaryUrl, extracted);
  } else if (extracted.documentType === "INVOICE") {
    await handleInvoice(chatId, msgId, cloudinaryUrl, extracted);
  } else {
    await sendMessage(chatId, `📄 Document received but couldn't classify as POP or invoice.\nCaption: ${message.caption || "none"}`, msgId);
  }
}

// ─── Claude Classification + Extraction ─────────────────────

type PopData = {
  documentType: "POP";
  amount: number | null;
  referenceNumber: string | null;
  description: string | null;
  invoiceReference: string | null;
  date: string | null;
  recipientName: string | null;
  recipientBank: string | null;
  recipientAccount: string | null;
};

type InvoiceData = {
  documentType: "INVOICE";
  invoiceNumber: string | null;
  amount: number | null;
  supplierName: string | null;
  date: string | null;
  items: { name: string; quantity: number; unitPrice: number; totalPrice: number; matchedProduct?: string }[];
};

type MultiPopData = {
  documentType: "MULTI_POP";
  payments: Omit<PopData, "documentType">[];
};

type ClassifiedDoc = PopData | InvoiceData | MultiPopData | null;

async function classifyAndExtract(url: string, isPdf: boolean): Promise<ClassifiedDoc> {
  // Fetch product + supplier catalogs + unpaid invoices for matching
  const [products, suppliers, unpaidInvoices] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, sku: true } }),
    prisma.supplier.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.invoice.findMany({
      where: { status: { in: ["PENDING", "INITIATED", "OVERDUE"] } },
      select: { invoiceNumber: true, amount: true, supplier: { select: { name: true } }, outlet: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const productCatalog = products.map((p) => `${p.name}${p.sku ? ` [${p.sku}]` : ""}`).join("\n");
  const supplierList = suppliers.map((s) => s.name).join("\n");
  const invoiceList = unpaidInvoices.map((i) => `${i.invoiceNumber} | ${i.supplier?.name ?? "?"} | ${i.outlet?.name ?? "?"} | RM ${Number(i.amount).toFixed(2)}`).join("\n");

  const contentBlocks: Anthropic.ContentBlockParam[] = [];

  if (isPdf) {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    contentBlocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: Buffer.from(buf).toString("base64") },
    } as Anthropic.ContentBlockParam);
  } else {
    contentBlocks.push({ type: "image", source: { type: "url", url } });
  }

  contentBlocks.push({
    type: "text",
    text: `Classify this document as one of:
- "POP" — a bank transfer proof of payment / transaction receipt (e.g. Maybank, CIMB, RHB transfer confirmation showing amount, reference, recipient)
- "MULTI_POP" — a PDF with MULTIPLE payment receipts / transfer confirmations (e.g. a batch payment report with several transfers)
- "INVOICE" — a supplier invoice, delivery order, receipt, or bill

Then extract the relevant fields.

UNPAID INVOICES (for matching POP):
${invoiceList}

For a SINGLE POP (one payment), return:
{
  "documentType": "POP",
  "amount": <number or null>,
  "referenceNumber": "<string or null>",
  "description": "<payment description/remarks/reference text or null>",
  "invoiceReference": "<if the payment description or remarks contain an invoice number from the list above, put it here, or null>",
  "date": "<YYYY-MM-DD or null>",
  "recipientName": "<string or null>",
  "recipientBank": "<string or null>",
  "recipientAccount": "<string or null>"
}

For MULTIPLE POPs in one document (batch payment / multi-page), return:
{
  "documentType": "MULTI_POP",
  "payments": [
    {
      "pageNumber": <which page this payment appears on, 1-indexed>,
      "amount": <number or null>,
      "referenceNumber": "<string or null>",
      "description": "<payment description/remarks or null>",
      "invoiceReference": "<matched invoice number from list above or null>",
      "date": "<YYYY-MM-DD or null>",
      "recipientName": "<string or null>",
      "recipientBank": "<string or null>",
      "recipientAccount": "<string or null>"
    }
  ]
}

For INVOICE, use the product catalog and supplier list below to match items and supplier name.

KNOWN SUPPLIERS:
${supplierList}

KNOWN PRODUCT CATALOG:
${productCatalog}

Match each invoice line item to the closest product from the catalog. Use the exact catalog name (without SKU in brackets) in "matchedProduct". If no match, leave matchedProduct as null.
Match the supplier/vendor name to one of the known suppliers. Use the exact supplier name from the list.

Return:
{
  "documentType": "INVOICE",
  "invoiceNumber": "<string or null>",
  "amount": <number or null — the total amount>,
  "supplierName": "<exact name from known suppliers or null>",
  "date": "<YYYY-MM-DD or null>",
  "items": [{ "name": "<item name on invoice>", "matchedProduct": "<exact catalog name or null>", "quantity": <number>, "unitPrice": <number>, "totalPrice": <number> }]
}

Return ONLY the JSON object, no markdown, no explanation.`,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(text);
  } catch {
    console.error("[telegram] Failed to parse Claude response:", text);
    return null;
  }
}

// ─── POP Matching ───────────────────────────────────────────

async function handlePop(chatId: number, msgId: number, photoUrl: string, pop: PopData) {
  if (!pop.amount) {
    await sendMessage(chatId, "💳 POP detected but couldn't extract the amount.", msgId);
    return;
  }

  const amount = pop.amount;
  const invoiceInclude = {
    supplier: { select: { id: true, name: true, telegramChatId: true, bankAccountNumber: true, bankName: true } },
    outlet: { select: { name: true, code: true } },
    order: { select: { orderNumber: true } },
  };

  // 1. Try matching by invoice reference (most direct — invoice number in payment description)
  if (pop.invoiceReference) {
    const byInvoiceRef = await prisma.invoice.findMany({
      where: {
        invoiceNumber: { equals: pop.invoiceReference, mode: "insensitive" },
        status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
      },
      include: invoiceInclude,
      take: 5,
    });
    if (byInvoiceRef.length > 0) {
      return await resolvePop(chatId, msgId, photoUrl, pop, amount, byInvoiceRef);
    }
  }

  // 2. Try matching by supplier bank account (precise)
  if (pop.recipientAccount) {
    const accountDigits = pop.recipientAccount.replace(/\D/g, "");
    const supplierByBank = await prisma.supplier.findFirst({
      where: { bankAccountNumber: { contains: accountDigits }, status: "ACTIVE" },
      select: { id: true },
    });
    if (supplierByBank) {
      const bankMatched = await prisma.invoice.findMany({
        where: {
          status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
          supplierId: supplierByBank.id,
          amount: { gte: amount - 0.5, lte: amount + 0.5 },
        },
        include: invoiceInclude,
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      if (bankMatched.length > 0) {
        return await resolvePop(chatId, msgId, photoUrl, pop, amount, bankMatched);
      }
    }
  }

  // 3. Find unpaid invoices — exact amount match
  let candidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
      amount: { equals: amount },
    },
    include: invoiceInclude,
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // 4. If no exact match, try ±RM 0.50 tolerance
  if (candidates.length === 0) {
    candidates = await prisma.invoice.findMany({
      where: {
        status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
        amount: { gte: amount - 0.5, lte: amount + 0.5 },
      },
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }

  // 5. Narrow by recipient name/bank if multiple matches
  if (candidates.length > 1 && (pop.recipientName || pop.recipientAccount)) {
    let narrowed = candidates;
    if (pop.recipientAccount) {
      const digits = pop.recipientAccount.replace(/\D/g, "");
      const byAccount = candidates.filter((inv) => inv.supplier?.bankAccountNumber?.replace(/\D/g, "") === digits);
      if (byAccount.length > 0) narrowed = byAccount;
    }
    if (narrowed.length > 1 && pop.recipientName) {
      const byName = narrowed.filter((inv) =>
        inv.supplier?.name?.toLowerCase().includes(pop.recipientName!.toLowerCase()),
      );
      if (byName.length > 0) narrowed = byName;
    }
    candidates = narrowed;
  }

  return await resolvePop(chatId, msgId, photoUrl, pop, amount, candidates);
}

async function resolvePop(
  chatId: number, msgId: number, photoUrl: string, pop: PopData, amount: number,
  candidates: Awaited<ReturnType<typeof prisma.invoice.findMany>>,
) {
  if (candidates.length === 0) {
    await sendMessage(chatId, `💳 POP received — RM ${amount.toFixed(2)}\nRef: ${pop.referenceNumber ?? "–"}\nRecipient: ${pop.recipientName ?? "–"}\nAccount: ${pop.recipientAccount ?? "–"}\n\n❌ No matching unpaid invoice found.`, msgId);
    return;
  }

  if (candidates.length > 1) {
    const list = candidates
      .map((inv: any) => `• ${inv.invoiceNumber} — ${inv.supplier?.name ?? "?"} [${inv.outlet?.code ?? "?"}] — RM ${Number(inv.amount).toFixed(2)}`)
      .join("\n");
    await sendMessage(chatId, `💳 POP received — RM ${amount.toFixed(2)}\n\n⚠️ Multiple matching invoices:\n${list}\n\nPlease specify which invoice.`, msgId);
    return;
  }

  // Single match — mark as PAID + create shortlink
  const invoice = candidates[0] as any;
  const shortLink = await createShortLink(photoUrl).catch(() => null);

  const result = await audited(
    {
      actorId: null, // system / webhook
      action: "INVOICE_MARK_PAID",
      module: "invoices",
      target: { id: invoice.id, name: invoice.invoiceNumber },
      metadata: {
        source: "telegram",
        amount,
        referenceNumber: pop.referenceNumber,
        recipientName: pop.recipientName,
        recipientAccount: pop.recipientAccount,
        popShortLink: shortLink,
      },
    },
    () =>
      prisma.invoice.updateMany({
        where: { id: invoice.id, status: { in: ["PENDING", "INITIATED", "OVERDUE"] } },
        data: {
          status: "PAID",
          paidAt: new Date(),
          paidVia: "Maybank Transfer",
          paymentRef: pop.referenceNumber,
          photos: { push: photoUrl },
          ...(shortLink ? { popShortLink: shortLink } : {}),
        },
      }),
  );

  if (result.count === 0) {
    await sendMessage(chatId, "⚠️ Invoice was already updated by someone else.", msgId);
    return;
  }

  // Also attach POP photo to the linked PO (Order)
  if (invoice.orderId) {
    await prisma.order.update({
      where: { id: invoice.orderId },
      data: { photos: { push: photoUrl } },
    }).catch((e: unknown) => console.error("[telegram] Failed to attach POP to order:", e));
  }

  const supplierName = invoice.supplier?.name ?? "Unknown";
  const outletName = invoice.outlet?.name ?? "";
  const outletCode = invoice.outlet?.code ?? "";
  const poRef = invoice.order?.orderNumber ? `\nPO: ${invoice.order.orderNumber}` : "";
  const outletRef = outletName ? `\nOutlet: ${outletName}${outletCode ? ` (${outletCode})` : ""}` : "";
  const receiptLink = shortLink ? `\n🔗 ${shortLink}` : "";
  await sendMessage(
    chatId,
    `✅ <b>Payment matched</b>\n\nInvoice: ${invoice.invoiceNumber}${poRef}${outletRef}\nSupplier: ${supplierName}\nAmount: RM ${Number(invoice.amount).toFixed(2)}\nRef: ${pop.referenceNumber ?? "–"}\n\nMarked as <b>PAID</b>.\n📎 Uploaded to PO + Invoice${receiptLink}`,
    msgId,
  );

  // Forward POP to supplier's Telegram group (or owner for testing)
  const forwardChatId = invoice.supplier?.telegramChatId
    ? parseInt(invoice.supplier.telegramChatId, 10)
    : process.env.TELEGRAM_OWNER_CHAT_ID
      ? parseInt(process.env.TELEGRAM_OWNER_CHAT_ID, 10)
      : null;

  if (forwardChatId) {
    await sendPhoto(
      forwardChatId,
      photoUrl,
      `✅ Payment confirmed\n\nInvoice: ${invoice.invoiceNumber}\nAmount: RM ${Number(invoice.amount).toFixed(2)}\nRef: ${pop.referenceNumber ?? "–"}\nDate: ${pop.date ?? "–"}`,
    );
  }
}

// ─── Supplier Invoice Matching ──────────────────────────────

async function handleInvoice(chatId: number, msgId: number, photoUrl: string, inv: InvoiceData) {
  const supplierName = inv.supplierName;
  const amount = inv.amount;

  if (!supplierName && !amount) {
    await sendMessage(chatId, "📄 Invoice detected but couldn't extract supplier or amount.", msgId);
    return;
  }

  // Find supplier by name
  let supplier = null;
  if (supplierName) {
    supplier = await prisma.supplier.findFirst({
      where: { name: { contains: supplierName, mode: "insensitive" }, status: "ACTIVE" },
    });
  }

  // Find matching PO
  const orderWhere: Record<string, unknown> = {
    orderType: "PURCHASE_ORDER",
    status: { in: ["SENT", "AWAITING_DELIVERY", "CONFIRMED"] },
  };
  if (supplier) orderWhere.supplierId = supplier.id;
  if (amount) orderWhere.totalAmount = { gte: amount - 1, lte: amount + 1 };

  const matchingOrders = await prisma.order.findMany({
    where: orderWhere,
    include: {
      supplier: { select: { name: true } },
      outlet: { select: { id: true, name: true } },
      invoices: { select: { id: true, photos: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  if (matchingOrders.length === 0) {
    await sendMessage(
      chatId,
      `📄 Invoice received\nSupplier: ${supplierName ?? "?"}\nAmount: RM ${amount?.toFixed(2) ?? "?"}\nInvoice #: ${inv.invoiceNumber ?? "–"}\n\n❌ No matching PO found.`,
      msgId,
    );
    return;
  }

  if (matchingOrders.length > 1) {
    const list = matchingOrders
      .map((o) => `• ${o.orderNumber} — ${o.supplier?.name ?? "?"} — RM ${Number(o.totalAmount).toFixed(2)}`)
      .join("\n");
    await sendMessage(
      chatId,
      `📄 Invoice received\nSupplier: ${supplierName ?? "?"}\nAmount: RM ${amount?.toFixed(2) ?? "?"}\n\n⚠️ Multiple matching POs:\n${list}\n\nPlease specify which PO.`,
      msgId,
    );
    return;
  }

  // Single match
  const order = matchingOrders[0];
  const existingInvoice = order.invoices[0];

  // Also attach invoice photo to the PO (Order)
  await prisma.order.update({
    where: { id: order.id },
    data: { photos: { push: photoUrl } },
  }).catch((e) => console.error("[telegram] Failed to attach invoice photo to order:", e));

  if (existingInvoice) {
    // Update existing invoice — add photo
    await prisma.invoice.update({
      where: { id: existingInvoice.id },
      data: {
        photos: { push: photoUrl },
        ...(inv.invoiceNumber ? { invoiceNumber: inv.invoiceNumber } : {}),
      },
    });

    await sendMessage(
      chatId,
      `✅ <b>Invoice photo added</b>\n\nPO: ${order.orderNumber}\nSupplier: ${order.supplier?.name ?? "?"}\nAmount: RM ${Number(order.totalAmount).toFixed(2)}\nInvoice #: ${inv.invoiceNumber ?? existingInvoice.id.slice(0, 8)}\n\n📎 Uploaded to PO + Invoice`,
      msgId,
    );
  } else {
    // Create new invoice linked to PO
    const invCount = await prisma.invoice.count();
    const invoiceNumber = inv.invoiceNumber || `INV-${String(invCount + 1).padStart(4, "0")}`;

    await prisma.invoice.create({
      data: {
        invoiceNumber,
        orderId: order.id,
        outletId: order.outlet.id,
        supplierId: order.supplierId ?? undefined,
        amount: amount ?? Number(order.totalAmount),
        status: "PENDING",
        paymentType: "SUPPLIER",
        photos: [photoUrl],
        issueDate: inv.date ? new Date(inv.date) : new Date(),
      },
    });

    await sendMessage(
      chatId,
      `✅ <b>Invoice created</b>\n\nPO: ${order.orderNumber}\nSupplier: ${order.supplier?.name ?? "?"}\nInvoice: ${invoiceNumber}\nAmount: RM ${(amount ?? Number(order.totalAmount)).toFixed(2)}\n\n📎 Uploaded to PO + Invoice`,
      msgId,
    );
  }
}
