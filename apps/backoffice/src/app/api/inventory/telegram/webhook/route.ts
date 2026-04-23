import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { createShortLink } from "@/lib/shortlink";
import { detectPaymentFlags, appendInvoiceFlags } from "@/lib/inventory/flag-detector";
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

  // 3. Upload. PDFs → Supabase Storage (Cloudinary blocks raw .pdf delivery
  // when the account has "Restricted media types: pdf" enabled). Images stay
  // on Cloudinary since the image pipeline (transformations, optimisation)
  // works fine.
  let docUrl: string;
  if (isPdf) {
    const { uploadToStorage } = await import("@/lib/inventory/pdf-splitter");
    docUrl = await uploadToStorage(buffer, `pop/pop-${Date.now()}.pdf`, "application/pdf");
  } else {
    const base64 = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    const upload = await cloudinary.uploader.upload(base64, {
      folder: "celsius-coffee/telegram-inbox",
      resource_type: "image",
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    });
    docUrl = upload.secure_url;
  }

  // 4. Classify + Extract via Claude
  const extracted = await classifyAndExtract(docUrl, isPdf, buffer);
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
      let pageUrl = docUrl;
      const pageNum = (payment as any).pageNumber;
      if (pageNum && pageUrls[pageNum - 1]) {
        pageUrl = pageUrls[pageNum - 1];
      } else if (pageUrls.length === 1) {
        pageUrl = pageUrls[0]; // Single page result
      }
      await handlePop(chatId, msgId, pageUrl, popData);
    }
  } else if (extracted.documentType === "POP") {
    await handlePop(chatId, msgId, docUrl, extracted);
  } else if (extracted.documentType === "INVOICE") {
    await handleInvoice(chatId, msgId, docUrl, extracted);
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
  deliveryCharge: number | null;
  supplierName: string | null;
  date: string | null;
  items: { name: string; quantity: number; unitPrice: number; totalPrice: number; matchedProduct?: string }[];
};

type MultiPopData = {
  documentType: "MULTI_POP";
  payments: Omit<PopData, "documentType">[];
};

type ClassifiedDoc = PopData | InvoiceData | MultiPopData | null;

async function classifyAndExtract(url: string, isPdf: boolean, pdfBuffer?: Buffer): Promise<ClassifiedDoc> {
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
    // Use the original buffer from Telegram rather than re-fetching from
    // Cloudinary — raw PDF URLs can be flaky, and we already have the bytes.
    let buf: Buffer | null = pdfBuffer ?? null;
    if (!buf) {
      const res = await fetch(url);
      if (!res.ok) return null;
      buf = Buffer.from(await res.arrayBuffer());
    }
    contentBlocks.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
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
  "amount": <number or null — the GRAND TOTAL payable, INCLUDING any delivery/shipping/service charges. This is what the customer pays, not the line-item subtotal.>,
  "deliveryCharge": <number or null — delivery, shipping, or service fee shown on the invoice (0 or null if none)>,
  "supplierName": "<exact name from known suppliers or null>",
  "date": "<YYYY-MM-DD or null>",
  "items": [{ "name": "<item name on invoice>", "matchedProduct": "<exact catalog name or null>", "quantity": <number>, "unitPrice": <number>, "totalPrice": <number> }]
}

Return ONLY the JSON object, no markdown, no explanation.`,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
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
    supplier: { select: { id: true, name: true, telegramChatId: true, bankAccountNumber: true, bankName: true, depositTermsDays: true } },
    outlet: { select: { name: true, code: true } },
    order: {
      select: {
        orderNumber: true,
        claimedBy: { select: { id: true, name: true, bankAccountNumber: true, bankName: true } },
      },
    },
  };

  // 0. Try matching an OPEN ClaimBatch first — Finance often pays many small
  // claims via a single bulk transfer. A batch's totalAmount matched against
  // the POP amount (± 0.50) resolves all its children in one stroke.
  // Narrow by recipient account if available (multiple batches can share a total).
  {
    const batchCandidates = await prisma.hrClaimBatch.findMany({
      where: {
        status: "OPEN",
        totalAmount: { gte: amount - 0.5, lte: amount + 0.5 },
      },
      include: {
        invoices: {
          select: { id: true, invoiceNumber: true, outletId: true },
        },
      },
      take: 10,
    });

    if (batchCandidates.length > 0) {
      // Narrow by recipient account (match payee's User.bankAccountNumber)
      let narrowed = batchCandidates;
      if (pop.recipientAccount) {
        const digits = pop.recipientAccount.replace(/\D/g, "");
        const payees = await prisma.user.findMany({
          where: { id: { in: batchCandidates.map((b) => b.userId) } },
          select: { id: true, bankAccountNumber: true },
        });
        const acctMap = new Map(payees.map((p) => [p.id, (p.bankAccountNumber || "").replace(/\D/g, "")]));
        const byAccount = batchCandidates.filter((b) => acctMap.get(b.userId) === digits);
        if (byAccount.length > 0) narrowed = byAccount;
      }

      if (narrowed.length === 1) {
        const batch = narrowed[0];
        const now = new Date();
        const ref = pop.referenceNumber ?? null;
        await prisma.$transaction(async (tx) => {
          await tx.hrClaimBatch.update({
            where: { id: batch.id },
            data: { status: "PAID", paidAt: now, paymentRef: ref, paidVia: "bank_transfer" },
          });
          await tx.invoice.updateMany({
            where: { claimBatchId: batch.id },
            data: { status: "PAID", paidAt: now, paidVia: "bank_transfer", paymentRef: ref, popShortLink: photoUrl },
          });
        });
        await sendMessage(
          chatId,
          `💳 POP received — RM ${amount.toFixed(2)}\n\n✅ Matched batch ${batch.batchNumber}\n${batch.invoices.length} claim${batch.invoices.length === 1 ? "" : "s"} settled in one go.`,
          msgId,
        );
        return;
      }
      if (narrowed.length > 1) {
        const list = narrowed
          .map((b) => `• ${b.batchNumber} — RM ${Number(b.totalAmount).toFixed(2)} (${b.invoices.length} claims)`)
          .join("\n");
        await sendMessage(
          chatId,
          `💳 POP received — RM ${amount.toFixed(2)}\n\n⚠️ Multiple matching batches:\n${list}\n\nPlease mark paid manually in the backoffice.`,
          msgId,
        );
        return;
      }
      // narrowed length 0 — fall through to individual invoice matching below
    }
  }

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

    // 2b. Try matching by staff (claimant) bank account — STAFF_CLAIM payouts
    const staffByBank = await prisma.user.findFirst({
      where: { bankAccountNumber: { contains: accountDigits }, status: "ACTIVE" },
      select: { id: true },
    });
    if (staffByBank) {
      const staffMatched = await prisma.invoice.findMany({
        where: {
          status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
          paymentType: "STAFF_CLAIM",
          order: { claimedById: staffByBank.id },
          amount: { gte: amount - 0.5, lte: amount + 0.5 },
        },
        include: invoiceInclude,
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      if (staffMatched.length > 0) {
        return await resolvePop(chatId, msgId, photoUrl, pop, amount, staffMatched);
      }
    }

    // 2c. Try matching one-off vendor bank account stored directly on the invoice
    // (used for asset/maintenance PAYMENT_REQUEST invoices that have no Supplier)
    const vendorMatched = await prisma.invoice.findMany({
      where: {
        status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
        vendorBankAccountNumber: { contains: accountDigits },
        amount: { gte: amount - 0.5, lte: amount + 0.5 },
      },
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    if (vendorMatched.length > 0) {
      return await resolvePop(chatId, msgId, photoUrl, pop, amount, vendorMatched);
    }
  }

  // 3. Find unpaid invoices — exact amount match (full OR deposit amount)
  let candidates = await prisma.invoice.findMany({
    where: {
      status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
      OR: [
        { amount: { equals: amount } },
        { depositAmount: { equals: amount } },
      ],
    },
    include: invoiceInclude,
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  // 4. If no exact match, try ±RM 0.50 tolerance (full OR deposit)
  if (candidates.length === 0) {
    candidates = await prisma.invoice.findMany({
      where: {
        status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
        OR: [
          { amount: { gte: amount - 0.5, lte: amount + 0.5 } },
          { depositAmount: { gte: amount - 0.5, lte: amount + 0.5 } },
        ],
      },
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }

  // 5. Narrow by recipient name/bank if multiple matches — check both supplier
  // and claimant (staff) records since the pool may contain either kind.
  if (candidates.length > 1 && (pop.recipientName || pop.recipientAccount)) {
    let narrowed = candidates;
    if (pop.recipientAccount) {
      const digits = pop.recipientAccount.replace(/\D/g, "");
      const byAccount = candidates.filter((inv: any) => {
        const sup = inv.supplier?.bankAccountNumber?.replace(/\D/g, "");
        const staff = inv.order?.claimedBy?.bankAccountNumber?.replace(/\D/g, "");
        return sup === digits || staff === digits;
      });
      if (byAccount.length > 0) narrowed = byAccount;
    }
    if (narrowed.length > 1 && pop.recipientName) {
      const needle = pop.recipientName.toLowerCase();
      const byName = narrowed.filter((inv: any) => {
        return (
          inv.supplier?.name?.toLowerCase().includes(needle) ||
          inv.order?.claimedBy?.name?.toLowerCase().includes(needle)
        );
      });
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
    // Finance pays identical-amount staff claims individually (e.g. Ariff has
    // two RM 10 claims at MT2, receives two separate RM 10 transfers). When
    // all candidates are the same claimant's STAFF_CLAIM at the same outlet,
    // consume the oldest one instead of asking to disambiguate — next POP
    // picks up the next one.
    const allStaffClaim = candidates.every((c: any) => c.paymentType === "STAFF_CLAIM");
    const claimantIds = new Set(candidates.map((c: any) => c.order?.claimedBy?.id));
    const outletIds = new Set(candidates.map((c: any) => c.outletId));
    if (allStaffClaim && claimantIds.size === 1 && !claimantIds.has(undefined) && outletIds.size === 1) {
      candidates = [...candidates].sort(
        (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ).slice(0, 1);
    } else {
      const list = candidates
        .map((inv: any) => {
          const payee = inv.paymentType === "STAFF_CLAIM"
            ? `Staff: ${inv.order?.claimedBy?.name ?? "?"}`
            : inv.supplier?.name ?? "?";
          return `• ${inv.invoiceNumber} — ${payee} [${inv.outlet?.code ?? "?"}] — RM ${Number(inv.amount).toFixed(2)}`;
        })
        .join("\n");
      await sendMessage(chatId, `💳 POP received — RM ${amount.toFixed(2)}\n\n⚠️ Multiple matching invoices:\n${list}\n\nPlease specify which invoice.`, msgId);
      return;
    }
  }

  // Single match — figure out if the POP matches the full amount or just the
  // deposit portion (supplier requires upfront deposit). If deposit, transition
  // to DEPOSIT_PAID and let finance submit the balance POP later for PAID.
  const invoice = candidates[0] as any;
  const depositAmt = invoice.depositAmount != null ? Number(invoice.depositAmount) : null;
  const fullAmt = Number(invoice.amount);
  const matchesDeposit = depositAmt != null && Math.abs(depositAmt - amount) <= 0.5;
  const matchesFull = Math.abs(fullAmt - amount) <= 0.5;
  // Prefer full-amount match when both could apply (safest default).
  const isDepositMatch = !matchesFull && matchesDeposit;

  // Rename the Supabase file to something human-readable now that we know
  // which invoice it belongs to. Falls back to the original URL if the file
  // lives outside Supabase (e.g. Cloudinary images) or if rename fails.
  let renamedUrl = photoUrl;
  let popSlug: string | undefined;
  try {
    const { popStoragePath, popDownloadName } = await import("@/lib/inventory/file-naming");
    const { moveInStorage } = await import("@/lib/inventory/pdf-splitter");
    const ext = /\.pdf(\?|$)/i.test(photoUrl) ? "pdf" : "jpg";
    const invForNaming = { ...invoice, paidAt: new Date() } as any;
    const newPath = popStoragePath(invForNaming, ext);
    const moved = await moveInStorage(photoUrl, newPath);
    if (moved) renamedUrl = moved;
    popSlug = popDownloadName(invForNaming, ext);
  } catch (err) {
    console.error("[telegram] POP rename failed:", err);
  }

  const shortLink = await createShortLink(renamedUrl, popSlug).catch(() => null);

  // DEPOSIT_PAID: stamp depositPaidAt + depositRef and compute balance due
  // from supplier.depositTermsDays (mirrors PATCH endpoint logic).
  let depositDueDate: Date | null = null;
  if (isDepositMatch) {
    const termsDays = invoice.supplier?.depositTermsDays;
    if (termsDays && termsDays > 0) {
      depositDueDate = new Date();
      depositDueDate.setDate(depositDueDate.getDate() + termsDays);
    }
  }

  const result = await prisma.invoice.updateMany({
    where: { id: invoice.id, status: { in: ["PENDING", "INITIATED", "OVERDUE"] } },
    data: isDepositMatch
      ? {
          status: "DEPOSIT_PAID",
          depositPaidAt: new Date(),
          depositRef: pop.referenceNumber,
          photos: { push: renamedUrl },
          ...(shortLink ? { popShortLink: shortLink } : {}),
          ...(depositDueDate ? { dueDate: depositDueDate } : {}),
        }
      : {
          status: "PAID",
          paidAt: new Date(),
          paidVia: "Maybank Transfer",
          paymentRef: pop.referenceNumber,
          photos: { push: renamedUrl },
          ...(shortLink ? { popShortLink: shortLink } : {}),
        },
  });

  if (result.count === 0) {
    await sendMessage(chatId, "⚠️ Invoice was already updated by someone else.", msgId);
    return;
  }

  // Detect review-worthy issues: duplicate paymentRef, ref points at a paid
  // invoice, bank mismatch, tolerance-only match. Surfaces as flags in the UI
  // so finance can manually accept or reject.
  try {
    const matchedAmount = isDepositMatch ? Number(invoice.depositAmount) : Number(invoice.amount);
    const matchMethod: "exact" | "tolerance" = Math.abs(matchedAmount - amount) < 0.01 ? "exact" : "tolerance";
    const popFlags = await detectPaymentFlags({
      invoiceId: invoice.id,
      paymentRef: pop.referenceNumber ?? null,
      popInvoiceReference: pop.invoiceReference ?? null,
      popRecipientAccount: pop.recipientAccount ?? null,
      matchMethod,
    });
    if (popFlags.length > 0) {
      await appendInvoiceFlags(invoice.id, popFlags);
      const flagList = popFlags.map((f) => `• ${f.message}`).join("\n");
      await sendMessage(
        chatId,
        `⚠️ <b>Review needed</b> on ${invoice.invoiceNumber}:\n${flagList}\n\nOpen the invoices tab to accept or reject.`,
        msgId,
      );
    }
  } catch (e) {
    console.error("[telegram] Flag detection failed:", e);
  }

  // Also attach POP photo to the linked PO (Order)
  if (invoice.orderId) {
    await prisma.order.update({
      where: { id: invoice.orderId },
      data: { photos: { push: renamedUrl } },
    }).catch((e: unknown) => console.error("[telegram] Failed to attach POP to order:", e));
  }

  const isStaffClaim = invoice.paymentType === "STAFF_CLAIM";
  const payeeLabel = isStaffClaim
    ? `Staff: ${invoice.order?.claimedBy?.name ?? "Unknown"}`
    : invoice.supplier?.name
      ? `Supplier: ${invoice.supplier.name}`
      : invoice.vendorName
        ? `Vendor: ${invoice.vendorName}`
        : "Payee: Unknown";
  const outletName = invoice.outlet?.name ?? "";
  const outletCode = invoice.outlet?.code ?? "";
  const poRef = invoice.order?.orderNumber ? `\nPO: ${invoice.order.orderNumber}` : "";
  const outletRef = outletName ? `\nOutlet: ${outletName}${outletCode ? ` (${outletCode})` : ""}` : "";
  const receiptLink = shortLink ? `\n🔗 ${shortLink}` : "";
  const balanceLine = isDepositMatch
    ? `\nBalance still owing: RM ${(fullAmt - amount).toFixed(2)}${depositDueDate ? ` (due ${depositDueDate.toISOString().slice(0, 10)})` : ""}`
    : "";
  const statusLabel = isDepositMatch ? "DEPOSIT PAID" : "PAID";
  const payType = isDepositMatch ? "Deposit" : "Payment";
  await sendMessage(
    chatId,
    `✅ <b>${payType} matched</b>\n\nInvoice: ${invoice.invoiceNumber}${poRef}${outletRef}\n${payeeLabel}\n${isDepositMatch ? `Deposit` : `Amount`}: RM ${amount.toFixed(2)}${isDepositMatch ? ` / RM ${fullAmt.toFixed(2)} total` : ""}${balanceLine}\nRef: ${pop.referenceNumber ?? "–"}\n\nMarked as <b>${statusLabel}</b>.\n📎 Uploaded to PO + Invoice${receiptLink}`,
    msgId,
  );

  // Forward POP: supplier → their Telegram group; staff claim → owner chat
  // (staff don't have a Telegram group linked).
  const forwardChatId = !isStaffClaim && invoice.supplier?.telegramChatId
    ? parseInt(invoice.supplier.telegramChatId, 10)
    : process.env.TELEGRAM_OWNER_CHAT_ID
      ? parseInt(process.env.TELEGRAM_OWNER_CHAT_ID, 10)
      : null;

  if (forwardChatId) {
    await sendPhoto(
      forwardChatId,
      photoUrl,
      `✅ Payment confirmed\n\nInvoice: ${invoice.invoiceNumber}\n${payeeLabel}\nAmount: RM ${Number(invoice.amount).toFixed(2)}\nRef: ${pop.referenceNumber ?? "–"}\nDate: ${pop.date ?? "–"}`,
    );
  }
}

// ─── Supplier Invoice Matching ──────────────────────────────

async function handleInvoice(chatId: number, msgId: number, photoUrl: string, inv: InvoiceData) {
  const supplierName = inv.supplierName;
  const amount = inv.amount;
  // Delivery/shipping/service charges — AI extracts these separately so we
  // can back them out when matching against a PO (PO stores line-item subtotal
  // only) but add them back in for the invoice amount customers actually pay.
  const deliveryCharge = inv.deliveryCharge ?? 0;

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
  // Match against order.totalAmount using the subtotal (amount minus delivery),
  // since order.totalAmount is the line-item subtotal. Loosened tolerance to
  // ±RM 2 to absorb rounding when Claude splits delivery out.
  const subtotalForMatch = amount != null ? amount - deliveryCharge : null;
  const orderWhere: Record<string, unknown> = {
    orderType: "PURCHASE_ORDER",
    status: { in: ["SENT", "AWAITING_DELIVERY", "CONFIRMED"] },
  };
  if (supplier) orderWhere.supplierId = supplier.id;
  if (subtotalForMatch != null) orderWhere.totalAmount = { gte: subtotalForMatch - 2, lte: subtotalForMatch + 2 };

  const matchingOrders = await prisma.order.findMany({
    where: orderWhere,
    include: {
      supplier: { select: { name: true } },
      outlet: { select: { id: true, name: true } },
      invoices: { select: { id: true, photos: true, amount: true, status: true } },
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

  // Effective amount payable = AI-extracted grand total (preferred) or the
  // PO subtotal plus any delivery charge the AI pulled out separately.
  // This is what POPs will be matched against later, so it must include
  // delivery/service fees that the supplier actually bills.
  const effectiveAmount = amount ?? (Number(order.totalAmount) + deliveryCharge);

  // Rename the Supabase file to a readable invoice name now that we know the
  // supplier, amount, and invoice number. Safe no-op for Cloudinary images.
  let renamedUrl = photoUrl;
  try {
    const { invoiceStoragePath } = await import("@/lib/inventory/file-naming");
    const { moveInStorage } = await import("@/lib/inventory/pdf-splitter");
    const ext = /\.pdf(\?|$)/i.test(photoUrl) ? "pdf" : "jpg";
    const newPath = invoiceStoragePath(
      {
        invoiceNumber: inv.invoiceNumber || order.orderNumber,
        amount: effectiveAmount,
        supplier: order.supplier ?? null,
      } as any,
      ext,
    );
    const moved = await moveInStorage(photoUrl, newPath);
    if (moved) renamedUrl = moved;
  } catch (err) {
    console.error("[telegram] Invoice rename failed:", err);
  }

  // Also attach invoice photo to the PO (Order)
  await prisma.order.update({
    where: { id: order.id },
    data: { photos: { push: renamedUrl } },
  }).catch((e) => console.error("[telegram] Failed to attach invoice photo to order:", e));

  if (existingInvoice) {
    // Update existing invoice — add photo, and correct the amount if the
    // AI-extracted grand total is materially higher than what's stored
    // (typically because the receiving flow created the invoice with
    // order.totalAmount = subtotal and missed the delivery charge). Only
    // touch amount on unpaid invoices so we don't rewrite settled records.
    const storedAmount = Number(existingInvoice.amount);
    const shouldCorrectAmount =
      effectiveAmount > storedAmount + 0.5 &&
      ["PENDING", "INITIATED", "OVERDUE", "DRAFT"].includes(existingInvoice.status);

    const updateData: Record<string, unknown> = {
      photos: { push: renamedUrl },
      ...(inv.invoiceNumber ? { invoiceNumber: inv.invoiceNumber } : {}),
      ...(shouldCorrectAmount ? { amount: effectiveAmount } : {}),
    };
    await prisma.invoice.update({
      where: { id: existingInvoice.id },
      data: updateData,
    });

    const correctionLine = shouldCorrectAmount
      ? `\n💡 Amount corrected: RM ${storedAmount.toFixed(2)} → RM ${effectiveAmount.toFixed(2)} (delivery ${deliveryCharge ? `+RM ${deliveryCharge.toFixed(2)}` : "included"})`
      : "";
    await sendMessage(
      chatId,
      `✅ <b>Invoice photo added</b>\n\nPO: ${order.orderNumber}\nSupplier: ${order.supplier?.name ?? "?"}\nAmount: RM ${effectiveAmount.toFixed(2)}\nInvoice #: ${inv.invoiceNumber ?? existingInvoice.id.slice(0, 8)}${correctionLine}\n\n📎 Uploaded to PO + Invoice`,
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
        amount: effectiveAmount,
        status: "PENDING",
        paymentType: "SUPPLIER",
        photos: [renamedUrl],
        issueDate: inv.date ? new Date(inv.date) : new Date(),
      },
    });

    const deliveryLine = deliveryCharge > 0 ? `\nDelivery: RM ${deliveryCharge.toFixed(2)}` : "";
    await sendMessage(
      chatId,
      `✅ <b>Invoice created</b>\n\nPO: ${order.orderNumber}\nSupplier: ${order.supplier?.name ?? "?"}\nInvoice: ${invoiceNumber}\nAmount: RM ${effectiveAmount.toFixed(2)}${deliveryLine}\n\n📎 Uploaded to PO + Invoice`,
      msgId,
    );
  }
}
