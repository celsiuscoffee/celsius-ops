import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { randomBytes } from "crypto";
import { v2 as cloudinary } from "cloudinary";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { createShortLink } from "@/lib/shortlink";
import { detectPaymentFlags, appendInvoiceFlags } from "@/lib/inventory/flag-detector";
import { computeDepositAmount } from "@/lib/inventory/deposit";
import { sendProofOfPayment } from "@/lib/inventory/procurement-whatsapp";
import { rescueNoMatch, judgeDuplicate } from "@/lib/inventory/agents/pop-verifier-run";
import { runInternalAssistant, assistantEnabled } from "@/lib/ops-intake/assistant";
import { resolveOwner } from "@/lib/ops-pulse/router";
import {
  sendMessage,
  sendPhoto,
  getFileUrl,
  downloadFile,
  editMessageText,
  answerCallbackQuery,
  type TelegramUpdate,
  type TelegramMessage,
  type TelegramCallbackQuery,
  type InlineKeyboardMarkup,
} from "@/lib/telegram";
import {
  writeJsonToStorage,
  readJsonFromStorage,
  deleteFromStorage,
} from "@/lib/inventory/pdf-splitter";

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

  // Inline-button tap on a multi-match POP disambiguation message.
  if (update.callback_query) {
    const cb = update.callback_query;
    after(async () => {
      try {
        await processCallback(cb);
      } catch (err) {
        console.error("[telegram webhook] Callback error:", err);
        await answerCallbackQuery(cb.id, "Error — try again", true);
      }
    });
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  if (!message) return NextResponse.json({ ok: true });

  // Only process photos and documents (images/PDFs)
  const hasPhoto = message.photo && message.photo.length > 0;
  const hasDoc = message.document && /\.(pdf|jpg|jpeg|png|webp)$/i.test(message.document.file_name ?? "");

  // Plain text from the OWNER's chat → the internal assistant (same brain as
  // the WhatsApp channel, owner scope + database tools). Telegram is the richer
  // owner pipe: no 24h window, no per-message cost, long replies render fine.
  // Text from any other chat stays ignored (historic behavior — this webhook is
  // otherwise the POP inbox).
  const text = (message.text ?? "").trim();
  if (text && !hasPhoto && !hasDoc) {
    const ownerChat = (process.env.TELEGRAM_OWNER_CHAT_ID ?? "").trim();
    if (ownerChat && String(message.chat.id) === ownerChat) {
      after(async () => {
        try {
          await handleOwnerTelegramText(message.chat.id, message.message_id, text);
        } catch (err) {
          console.error("[telegram webhook] assistant error:", err);
          await sendMessage(message.chat.id, "⚠️ Assistant hit an error — try again.", message.message_id);
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

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

// ─── Owner assistant (text messages) ────────────────────────
// Same brain as the WhatsApp internal assistant, owner scope (all outlets +
// finance + database tools). Stateless per message for now — Telegram thread
// history isn't persisted. A problem report files a SystemReport exactly like
// the WhatsApp path (source "telegram"); no owner digest — the owner IS the
// reporter here.
async function handleOwnerTelegramText(chatId: number, msgId: number, text: string) {
  if (!assistantEnabled()) {
    await sendMessage(chatId, "Assistant is off (INTERNAL_ASSISTANT=off or no API key).", msgId);
    return;
  }
  const owner = await resolveOwner();
  if (!owner) {
    await sendMessage(chatId, "No active OWNER user found in BackOffice.", msgId);
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: owner.userId },
    select: { outletId: true, outletIds: true },
  });
  // Conversation memory: telegram exchanges are stored in the WhatsAppMessage
  // store under a `tg:<chatId>` pseudo-number (written directly — NOT via the
  // record helpers, whose digit-stripping could collide a chat id with a real
  // phone). The unique waMessageId makes Telegram redeliveries idempotent.
  const tgNumber = `tg:${chatId}`;
  const history = await prisma.whatsAppMessage.findMany({
    where: { OR: [{ fromNumber: tgNumber }, { toNumber: tgNumber }] },
    orderBy: { timestamp: "desc" },
    take: 12,
    select: { direction: true, body: true },
  });
  await prisma.whatsAppMessage
    .create({
      data: {
        waMessageId: `tg:${chatId}:${msgId}`,
        direction: "inbound",
        fromNumber: tgNumber,
        toNumber: "assistant",
        type: "text",
        body: text,
        timestamp: new Date(),
        raw: { telegram: true },
      },
    })
    .catch(() => {}); // duplicate wamid on redelivery — fine
  const outcome = await runInternalAssistant({
    reporter: {
      id: owner.userId,
      name: owner.name,
      role: "OWNER",
      outletId: user?.outletId ?? null,
      outletIds: user?.outletIds ?? [],
    },
    text,
    history: history.reverse(),
  });
  if (outcome.kind === "reply") {
    await prisma.whatsAppMessage
      .create({
        data: {
          direction: "outbound",
          fromNumber: "assistant",
          toNumber: tgNumber,
          type: "text",
          body: outcome.text,
          timestamp: new Date(),
          raw: { telegram: true, agent: "ops-intake-v1" },
        },
      })
      .catch(() => {});
    // Telegram caps a message at 4096 chars — chunk long replies.
    for (let i = 0; i < outcome.text.length; i += 3900) {
      await sendMessage(chatId, outcome.text.slice(i, i + 3900), i === 0 ? msgId : undefined);
    }
    return;
  }
  if (outcome.kind === "report") {
    const report = await prisma.systemReport.create({
      data: {
        reporterUserId: owner.userId,
        reporterName: owner.name,
        reporterPhone: owner.phone ?? `telegram:${chatId}`,
        body: text,
        source: "telegram",
      },
      select: { id: true },
    });
    await sendMessage(chatId, `🐞 Logged as a system report (ref ${report.id.slice(0, 8)}).`, msgId);
    return;
  }
  await sendMessage(chatId, "Couldn't work that one out — try rephrasing, or check BackOffice.", msgId);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
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
  outletHint: string | null;
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
  // Fetch product + supplier + outlet catalogs + unpaid invoices for matching
  const [products, suppliers, outlets, unpaidInvoices] = await Promise.all([
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, sku: true } }),
    prisma.supplier.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
    prisma.outlet.findMany({ where: { status: "ACTIVE" }, select: { name: true, code: true } }),
    prisma.invoice.findMany({
      where: { status: { in: ["PENDING", "INITIATED", "OVERDUE"] } },
      select: { invoiceNumber: true, amount: true, supplier: { select: { name: true } }, outlet: { select: { name: true, code: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const productCatalog = products.map((p) => `${p.name}${p.sku ? ` [${p.sku}]` : ""}`).join("\n");
  const supplierList = suppliers.map((s) => s.name).join("\n");
  const outletList = outlets.map((o) => `${o.code} (${o.name})`).join("\n");
  const invoiceList = unpaidInvoices.map((i) => `${i.invoiceNumber} | ${i.supplier?.name ?? "?"} | ${i.outlet?.name ?? "?"} [${i.outlet?.code ?? "?"}] | RM ${Number(i.amount).toFixed(2)}`).join("\n");

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
  "invoiceReference": "<the invoice number this payment is for, taken from the payment description/remarks/reference. Prefer exact matches against the list above, but also return any invoice-number-shaped string you see (e.g. INV-0498, 26-0447, 365IN2605-0049) even if not in the list. Null only if no invoice number is anywhere on the receipt.>",
  "outletHint": "<if the receipt mentions an outlet from the OUTLETS list below — by code, by name, or as a clear branch/location hint anywhere on the receipt (description, recipient, sender, remarks, header, footer) — return the matching outlet code. Null otherwise.>",
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
      "invoiceReference": "<invoice number from description/remarks — prefer matches in the list above, else any invoice-number-shaped string, null otherwise>",
      "outletHint": "<matching outlet code from the OUTLETS list below if the receipt hints at one, else null>",
      "date": "<YYYY-MM-DD or null>",
      "recipientName": "<string or null>",
      "recipientBank": "<string or null>",
      "recipientAccount": "<string or null>"
    }
  ]
}

For INVOICE, use the product catalog and supplier list below to match items and supplier name.

OUTLETS (code → name):
${outletList}

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

// ─── POP Multi-Match Disambiguation (Inline Buttons) ────────

// Stashed in Supabase Storage at pop/meta/<token>.json when a POP yields >1
// candidate invoice. Finance taps an inline button → callback fires → we read
// the meta, look up the chosen invoice, and run the single-match payment path.
type PopMeta = {
  amount: number;
  pop: PopData;
  photoUrl: string;
  chatId: number;
  replyToMessageId: number;
  candidateIds: string[];
  createdAt: string;
};

async function processCallback(cb: TelegramCallbackQuery) {
  const data = cb.data ?? "";
  // Format: pop:<token>:<idx>
  const m = data.match(/^pop:([A-Za-z0-9_-]+):(\d+)$/);
  if (!m) {
    await answerCallbackQuery(cb.id, "Unknown action");
    return;
  }
  const [, token, idxStr] = m;
  const idx = parseInt(idxStr, 10);

  const metaPath = `pop/meta/${token}.json`;
  const meta = await readJsonFromStorage<PopMeta>(metaPath);
  if (!meta) {
    await answerCallbackQuery(cb.id, "This selection expired. Mark paid in the backoffice.", true);
    if (cb.message) {
      await editMessageText(
        cb.message.chat.id,
        cb.message.message_id,
        `${cb.message.text ?? ""}\n\n⏱ Selection expired.`,
      );
    }
    return;
  }

  const invoiceId = meta.candidateIds[idx];
  if (!invoiceId) {
    await answerCallbackQuery(cb.id, "Invalid choice", true);
    return;
  }

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

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: invoiceInclude,
  });

  if (!invoice) {
    await answerCallbackQuery(cb.id, "Invoice not found", true);
    return;
  }

  // Already paid? Tell the user and clear the buttons.
  if (!(["PENDING", "INITIATED", "OVERDUE"] as string[]).includes(invoice.status)) {
    await answerCallbackQuery(cb.id, `Already ${invoice.status}`, true);
    if (cb.message) {
      await editMessageText(
        cb.message.chat.id,
        cb.message.message_id,
        `${cb.message.text ?? ""}\n\n⚠️ ${invoice.invoiceNumber} is already ${invoice.status}.`,
      );
    }
    await deleteFromStorage(metaPath).catch(() => {});
    await closePendingPop(token, invoiceId);
    return;
  }

  // Acknowledge the tap immediately so Telegram clears the spinner.
  await answerCallbackQuery(cb.id, `Marking ${invoice.invoiceNumber} paid…`);

  // Strip the buttons from the original message and mark which one was picked.
  if (cb.message) {
    const picker = cb.from.first_name ?? "Someone";
    await editMessageText(
      cb.message.chat.id,
      cb.message.message_id,
      `${cb.message.text ?? ""}\n\n👉 ${picker} picked <b>${invoice.invoiceNumber}</b> [${invoice.outlet?.code ?? "?"}]`,
    );
  }

  // Run the single-match payment path — same logic as if amount-matching had
  // returned exactly one candidate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  await resolvePop(meta.chatId, meta.replyToMessageId, meta.photoUrl, meta.pop, meta.amount, [invoice as any]);

  // Clean up the meta blob so the bucket doesn't accumulate.
  await deleteFromStorage(metaPath).catch(() => {});
  // Close the persisted PendingPop so its "possible POP" badge clears in BackOffice.
  await closePendingPop(token, invoiceId);
}

// Resolve the persisted PendingPop for a Telegram picker token (best-effort — never throws).
async function closePendingPop(token: string, invoiceId: string) {
  await prisma.pendingPop
    .updateMany({
      where: { token, status: "OPEN" },
      data: { status: "RESOLVED", resolvedInvoiceId: invoiceId, resolvedAt: new Date() },
    })
    .catch(() => {});
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
          // amountPaid must mirror each row's `amount`, which updateMany can't
          // do (no self-reference in data). One SQL UPDATE handles it.
          await tx.$executeRaw`UPDATE "Invoice" SET "amountPaid" = "amount" WHERE "claimBatchId" = ${batch.id} AND status = 'PAID'`;
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
    let byInvoiceRef = await prisma.invoice.findMany({
      where: {
        invoiceNumber: { equals: pop.invoiceReference, mode: "insensitive" },
        status: { in: ["PENDING", "INITIATED", "OVERDUE"] },
      },
      include: invoiceInclude,
      take: 5,
    });
    // The same number can sit on rows for DIFFERENT suppliers/outlets: GRNI
    // placeholders share one INV-<n> sequence across all suppliers, and capture
    // mistakes have stamped one vendor's number onto another's invoice (real
    // case: INV-1844 open on both Yow Seng RM1312.30 and Unique Paper RM260.47;
    // IVCT-00012381 on both Milk n Moka RM432 and TMM RM509.76). The receipt
    // carries more than the number — narrow by amount, payee, and outlet before
    // ever asking a human to pick.
    if (byInvoiceRef.length > 1) {
      // (a) Amount — full or deposit leg within the usual ±RM0.50 tolerance.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const byAmt = byInvoiceRef.filter((inv: any) => {
        const full = Math.abs(Number(inv.amount) - amount) <= 0.5;
        const dep = inv.depositAmount != null && Math.abs(Number(inv.depositAmount) - amount) <= 0.5;
        return full || dep;
      });
      if (byAmt.length > 0) byInvoiceRef = byAmt;
    }
    if (byInvoiceRef.length > 1 && pop.recipientName) {
      // (b) Payee — distinctive-token overlap between the transfer's recipient
      // and the row's supplier/vendor/claimant ("MILK & MOKA MARKETIN" shares
      // "moka" with "Milk n Moka" but nothing with "The Milk Ministry").
      const GENERIC = new Set(["sdn", "bhd", "the", "enterprise", "trading", "resources", "marketing", "malaysia"]);
      const tokens = (s: string) =>
        s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERIC.has(t));
      const payeeTokens = new Set(tokens(pop.recipientName));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const byPayee = byInvoiceRef.filter((inv: any) => {
        const name = inv.supplier?.name ?? inv.vendorName ?? inv.order?.claimedBy?.name;
        return name ? tokens(name).some((t) => payeeTokens.has(t)) : false;
      });
      if (byPayee.length > 0 && byPayee.length < byInvoiceRef.length) byInvoiceRef = byPayee;
    }
    if (byInvoiceRef.length > 1 && pop.outletHint) {
      // (c) Outlet — same rule as the amount-path narrowing below.
      const hint = pop.outletHint.toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const byOutlet = byInvoiceRef.filter((inv: any) => {
        const code = inv.outlet?.code?.toLowerCase();
        const name = inv.outlet?.name?.toLowerCase();
        return (code && hint.includes(code)) || (name && hint.includes(name));
      });
      if (byOutlet.length > 0) byInvoiceRef = byOutlet;
    }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const byAccount = candidates.filter((inv: any) => {
        const sup = inv.supplier?.bankAccountNumber?.replace(/\D/g, "");
        const staff = inv.order?.claimedBy?.bankAccountNumber?.replace(/\D/g, "");
        return sup === digits || staff === digits;
      });
      if (byAccount.length > 0) narrowed = byAccount;
    }
    if (narrowed.length > 1 && pop.recipientName) {
      const needle = pop.recipientName.toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
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

  // 6. Narrow by invoice number — Stage 1 only fires on an exact catalog hit.
  // When suppliers send the same SKU to multiple outlets at the same price,
  // amount-matching returns 3 candidates that differ only by outlet. If the
  // POP description/remark/invoiceReference contains any candidate's invoice
  // number (even substring-style: "INV-0498" inside "Payment for INV-0498"),
  // collapse to that one.
  if (candidates.length > 1) {
    const haystack = [pop.invoiceReference, pop.description, pop.referenceNumber]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (haystack) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const byInvNum = candidates.filter((inv: any) => {
        const n = inv.invoiceNumber?.toLowerCase();
        return n && haystack.includes(n);
      });
      if (byInvNum.length > 0) candidates = byInvNum;
    }
  }

  // 7. Narrow by outlet — same suppliers deliver the same SKU at the same
  // price across CC001/CC002/CC003 and produce identical-amount invoices.
  // If the receipt mentions an outlet code or name, use it to disambiguate.
  if (candidates.length > 1 && pop.outletHint) {
    const hint = pop.outletHint.toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const byOutlet = candidates.filter((inv: any) => {
      const code = inv.outlet?.code?.toLowerCase();
      const name = inv.outlet?.name?.toLowerCase();
      return (code && hint.includes(code)) || (name && hint.includes(name));
    });
    if (byOutlet.length > 0) candidates = byOutlet;
  }

  // 8. Reference-vs-candidate guard. When the receipt NAMES a specific invoice
  // (e.g. "IVCT-00012222") and none of the amount-matched candidates IS that
  // invoice, the payment belongs to the named invoice — not a same-amount
  // sibling. This is the fixed-amount trap: Milk n Moka / TMM bill identical
  // amounts every order, so blind amount-matching lands the payment on the
  // wrong invoice AND trips the "reference matches a paid invoice" double-pay
  // review. Only vetoes when the reference is a REAL, known invoice number (not
  // OCR noise): drop the mismatched siblings so this routes to the AI verifier /
  // finance instead of silently paying the wrong one. The correctly-named
  // invoice, when still open, already matched in step 1.
  if (candidates.length > 0 && pop.invoiceReference) {
    const refNorm = pop.invoiceReference.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (refNorm.length >= 5) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const refHitsCandidate = candidates.some((c: any) => {
        const n = (c.invoiceNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
        return n.length >= 5 && (n === refNorm || n.endsWith(refNorm) || refNorm.endsWith(n));
      });
      if (!refHitsCandidate) {
        const named = await prisma.invoice.findFirst({
          where: { invoiceNumber: { contains: pop.invoiceReference, mode: "insensitive" } },
          select: { id: true, invoiceNumber: true, status: true, paidVia: true },
        });
        const namedNorm = named ? named.invoiceNumber.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
        const namesReal = !!named && (namedNorm === refNorm || namedNorm.endsWith(refNorm) || refNorm.endsWith(namedNorm));
        if (namesReal) {
          console.warn(
            `[telegram:pop] ref "${pop.invoiceReference}" names ${named!.invoiceNumber} (${named!.status}) — not among the RM${amount} candidates; not auto-paying a same-amount sibling`,
          );
          candidates = [];
        }
      }
    }
  }

  return await resolvePop(chatId, msgId, photoUrl, pop, amount, candidates);
}

async function resolvePop(
  chatId: number, msgId: number, photoUrl: string, pop: PopData, amount: number,
  candidates: Awaited<ReturnType<typeof prisma.invoice.findMany>>,
) {
  // Snapshot the POP fields the AI POP-match verifier needs (same shape for both dead-ends).
  const popForVerify = {
    amount,
    referenceNumber: pop.referenceNumber,
    recipientName: pop.recipientName,
    recipientAccount: pop.recipientAccount,
    recipientBank: pop.recipientBank,
    invoiceReference: pop.invoiceReference,
    date: pop.date,
  };

  if (candidates.length === 0) {
    // Dead-end #1 — the deterministic matcher found nothing. Before giving up (which leaves
    // a real payment unpaid → double-pay risk), let the AI verifier scan open invoices.
    const rescue = await rescueNoMatch(popForVerify, amount);
    if (rescue.action === "notify") {
      await sendMessage(chatId, rescue.message, msgId);
      return;
    }
    if (rescue.action === "pay") {
      // Verifier rescued a real payment the matcher missed (armed + confident + corroborated)
      // — pay it through the normal single-candidate path below.
      candidates = [rescue.invoice];
    } else {
      await sendMessage(chatId, `💳 POP received — RM ${amount.toFixed(2)}\nRef: ${pop.referenceNumber ?? "–"}\nRecipient: ${pop.recipientName ?? "–"}\nAccount: ${pop.recipientAccount ?? "–"}\n\n❌ No matching unpaid invoice found.`, msgId);
      return;
    }
  }

  if (candidates.length > 1) {
    // Finance pays identical-amount staff claims individually (e.g. Ariff has several RM 35
    // claims, each reimbursed by its own RM 35 transfer). For a STAFF reimbursement the payee is
    // the PERSON, not the outlet — a RM 35 transfer to Ariff settles one of his RM 35 claims no
    // matter which outlet the purchase was at. So consume the OLDEST claim whose amount EXACTLY
    // equals the POP when every such exact-amount candidate is the same claimant's STAFF_CLAIM:
    //   - exact-amount only, so a RM 35.00 POP can never grab a RM 35.20 claim;
    //   - single claimant, so it never settles the wrong person.
    // Next POP picks up the next one. Falls back to the same-outlet rule, then to ask-to-pick.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const allStaffClaim = candidates.every((c: any) => c.paymentType === "STAFF_CLAIM");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const claimantIds = new Set(candidates.map((c: any) => c.order?.claimedBy?.id));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const outletIds = new Set(candidates.map((c: any) => c.outletId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const exact = candidates.filter((c: any) => Math.abs(Number(c.amount) - amount) < 0.005);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
    const exactClaimantIds = new Set(exact.map((c: any) => c.order?.claimedBy?.id));
    const exactAllStaffOneClaimant =
      exact.length >= 1 &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      exact.every((c: any) => c.paymentType === "STAFF_CLAIM") &&
      exactClaimantIds.size === 1 && !exactClaimantIds.has(undefined);
    const byOldest =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (exactAllStaffOneClaimant) {
      // Same claimant, exact amount, ANY outlet → consume the oldest exact-amount claim.
      candidates = [...exact].sort(byOldest).slice(0, 1);
    } else if (allStaffClaim && claimantIds.size === 1 && !claimantIds.has(undefined) && outletIds.size === 1) {
      // Same claimant + same outlet (any amount within tolerance) → consume the oldest.
      candidates = [...candidates].sort(byOldest).slice(0, 1);
    } else {
      // Cap at 8 buttons (Telegram's practical limit per message is generous
      // but huge keyboards are unreadable on mobile).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
      const offered = candidates.slice(0, 8) as any[];
      const token = randomBytes(6).toString("base64url"); // ~8 chars, callback_data-safe
      const metaPath = `pop/meta/${token}.json`;
      const meta: PopMeta = {
        amount,
        pop,
        photoUrl,
        chatId,
        replyToMessageId: msgId,
        candidateIds: offered.map((c) => c.id),
        createdAt: new Date().toISOString(),
      };
      try {
        await writeJsonToStorage(metaPath, meta);
      } catch (err) {
        console.error("[telegram] Failed to stash POP meta:", err);
      }
      // Persist the ambiguous POP so BackOffice can surface a "possible POP match" on each
      // candidate invoice + let a human confirm it there, not only via this Telegram picker.
      // Best-effort — never break the Telegram reply. Closed on resolution (either path).
      try {
        const popDate = pop.date && !Number.isNaN(Date.parse(pop.date)) ? new Date(pop.date) : null;
        await prisma.pendingPop.create({
          data: {
            token,
            amount,
            referenceNumber: pop.referenceNumber ?? null,
            payeeName: pop.recipientName ?? null,
            bankName: pop.recipientBank ?? null,
            invoiceReference: pop.invoiceReference ?? null,
            date: popDate,
            photoUrl,
            candidateInvoiceIds: offered.map((c) => c.id),
            source: "telegram",
          },
        });
      } catch (err) {
        console.error("[telegram] Failed to persist PendingPop:", err);
      }

      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: offered.map((inv, idx) => {
          const payee = inv.paymentType === "STAFF_CLAIM"
            ? inv.order?.claimedBy?.name ?? "Staff"
            : inv.supplier?.name ?? inv.vendorName ?? "?";
          const payeeShort = payee.length > 14 ? payee.slice(0, 13) + "…" : payee;
          const outletCode = inv.outlet?.code ?? "?";
          return [{
            text: `${inv.invoiceNumber} · ${outletCode} · ${payeeShort} · RM ${Number(inv.amount).toFixed(2)}`,
            callback_data: `pop:${token}:${idx}`,
          }];
        }),
      };

      await sendMessage(
        chatId,
        `💳 POP received — RM ${amount.toFixed(2)}\n\n⚠️ Multiple matching invoices — tap to pick:`,
        msgId,
        keyboard,
      );
      return;
    }
  }

  // Single match — figure out if the POP matches the full amount or just the
  // deposit portion (supplier requires upfront deposit). If deposit, transition
  // to DEPOSIT_PAID and let finance submit the balance POP later for PAID.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
  const invoice = candidates[0] as any;
  const depositAmt = invoice.depositAmount != null ? Number(invoice.depositAmount) : null;
  const fullAmt = Number(invoice.amount);
  const matchesDeposit = depositAmt != null && Math.abs(depositAmt - amount) <= 0.5;
  const matchesFull = Math.abs(fullAmt - amount) <= 0.5;
  // Prefer full-amount match when both could apply (safest default).
  const isDepositMatch = !matchesFull && matchesDeposit;

  // Pre-flight: refuse to re-attach a paymentRef that's already on another
  // paid invoice (same bank payment recorded twice). Bails BEFORE renaming
  // the file or updating anything — operator must resolve manually.
  if (pop.referenceNumber) {
    const existingRef = await prisma.invoice.findFirst({
      where: {
        OR: [{ paymentRef: pop.referenceNumber }, { depositRef: pop.referenceNumber }],
        status: { in: ["PAID", "DEPOSIT_PAID"] },
        NOT: { id: invoice.id },
      },
      select: { invoiceNumber: true, paidAt: true, amount: true, paymentRef: true },
    });
    if (existingRef) {
      // Deterministic stop-bleed: a repeated bank reference only signals a genuine re-send when
      // the AMOUNT also matches. A DIFFERENT amount means a distinct payment that merely reuses a
      // ref (e.g. a shared corporate account) — the old code hard-blocked these, leaving a real
      // payment unpaid → double-pay. We now proceed to pay (the normal flag-detector still records
      // the reused ref as DUPLICATE_PAYMENT_REF for review). Only the same-amount case is ambiguous.
      const sameAmount = Math.abs(Number(existingRef.amount) - amount) <= 0.5;
      if (sameAmount) {
        // Same ref + same amount could be a real re-send OR a coincidental shared ref. The AI
        // verifier decides: "pay" (proceed), "notify" (proposed to a human), or "none" (block).
        const dup = await judgeDuplicate({
          pop: popForVerify,
          popAmount: amount,
          invoice,
          existingPaid: {
            invoiceNumber: existingRef.invoiceNumber,
            amount: Number(existingRef.amount),
            paidAt: existingRef.paidAt ? existingRef.paidAt.toISOString().slice(0, 10) : null,
            paymentRef: existingRef.paymentRef ?? pop.referenceNumber,
          },
        });
        if (dup.action === "notify") {
          await sendMessage(chatId, dup.message, msgId);
          return;
        }
        if (dup.action === "none") {
          await sendMessage(
            chatId,
            `⛔ <b>Duplicate POP blocked</b>\nRef <code>${pop.referenceNumber}</code> is already attached to <b>${existingRef.invoiceNumber}</b>${existingRef.paidAt ? ` (paid ${existingRef.paidAt.toISOString().slice(0, 10)})` : ""}.\n\nSame bank ref + same amount — likely the same payment re-sent. Verify before retrying.`,
            msgId,
          );
          return;
        }
        // dup.action === "pay" → verifier judged a distinct payment; fall through to pay.
      }
    }
  }

  // Rename the Supabase file to something human-readable now that we know
  // which invoice it belongs to. Falls back to the original URL if the file
  // lives outside Supabase (e.g. Cloudinary images) or if rename fails.
  let renamedUrl = photoUrl;
  let popSlug: string | undefined;
  try {
    const { popStoragePath, popDownloadName } = await import("@/lib/inventory/file-naming");
    const { moveInStorage } = await import("@/lib/inventory/pdf-splitter");
    const ext = /\.pdf(\?|$)/i.test(photoUrl) ? "pdf" : "jpg";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
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
  // as invoice.issueDate + termsDays (the deposit itself is due on issueDate;
  // the balance runs from the same anchor, not from when the deposit was paid).
  let depositDueDate: Date | null = null;
  if (isDepositMatch) {
    const termsDays = invoice.supplier?.depositTermsDays;
    if (termsDays && termsDays > 0 && invoice.issueDate) {
      depositDueDate = new Date(invoice.issueDate);
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
          amountPaid: Number(invoice.depositAmount),
          photos: { push: renamedUrl },
          ...(shortLink ? { popShortLink: shortLink } : {}),
          ...(depositDueDate ? { dueDate: depositDueDate } : {}),
        }
      : {
          status: "PAID",
          paidAt: new Date(),
          paidVia: "Maybank Transfer",
          paymentRef: pop.referenceNumber,
          amountPaid: Number(invoice.amount),
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

  // Send the supplier their Proof of Payment on WhatsApp — this was missing, so paying via
  // Telegram marked the invoice paid but never told the supplier. Full payments only (a
  // deposit POP is a different message, handled on the Invoices tab). sendProofOfPayment is
  // gated (PROCUREMENT_WHATSAPP_ENABLED) + idempotent (popSentAt) + never throws; report
  // the outcome back so the team knows whether the supplier actually received it.
  if (!isDepositMatch && invoice.supplier) {
    try {
      const popSend = await sendProofOfPayment(invoice.id);
      if (popSend.sent) {
        await sendMessage(chatId, `📤 POP sent to ${invoice.supplier?.name ?? "supplier"} on WhatsApp.`, msgId);
      } else if (popSend.reason && popSend.reason !== "already-sent") {
        await sendMessage(chatId, `⚠️ Supplier POP not sent (${popSend.reason}). Send it from the Invoices tab.`, msgId);
      }
    } catch (e) {
      console.error("[telegram] supplier POP send failed:", e);
    }
  }

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
  // Includes PARTIALLY_RECEIVED and recently-COMPLETED POs: credit-term
  // invoices routinely arrive AFTER (partial) delivery closed or shrank the
  // PO — post-delivery is exactly when the real invoice photo gets posted.
  // Mirrors the 45-day completed lookback the WhatsApp capture path uses.
  const COMPLETED_LOOKBACK = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const orderWhere: Record<string, unknown> = {
    orderType: "PURCHASE_ORDER",
    OR: [
      { status: { in: ["SENT", "AWAITING_DELIVERY", "CONFIRMED", "PARTIALLY_RECEIVED"] } },
      { status: "COMPLETED", updatedAt: { gte: COMPLETED_LOOKBACK } },
    ],
  };
  if (supplier) orderWhere.supplierId = supplier.id;
  if (subtotalForMatch != null) orderWhere.totalAmount = { gte: subtotalForMatch - 2, lte: subtotalForMatch + 2 };

  const matchingOrders = await prisma.order.findMany({
    where: orderWhere,
    include: {
      supplier: { select: { name: true } },
      outlet: { select: { id: true, name: true } },
      invoices: { select: { id: true, photos: true, amount: true, status: true, depositAmount: true } },
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
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
    // Update existing invoice — add photo, and correct amount + backfill
    // depositAmount when the row needs it. Both corrections apply only to
    // unpaid invoices so we don't rewrite settled records.
    //
    // Amount correction: receiving flow creates invoices with
    // order.totalAmount = subtotal; the AI-extracted grand total may be
    // higher (delivery/service fees). Bump the stored amount if so.
    //
    // Deposit backfill: receivings/orders paths used to skip the deposit
    // calc, so invoices from those paths have depositAmount = null even
    // when the supplier requires one — POP matcher can never hit
    // DEPOSIT_PAID in that state. Fill it in using the current effective
    // amount as the base.
    const storedAmount = Number(existingInvoice.amount);
    const isUnpaid = ["PENDING", "INITIATED", "OVERDUE", "DRAFT"].includes(existingInvoice.status);
    const shouldCorrectAmount = effectiveAmount > storedAmount + 0.5 && isUnpaid;

    const existingDepositAmount = (existingInvoice as { depositAmount: unknown }).depositAmount;
    const shouldBackfillDeposit = isUnpaid && existingDepositAmount == null;
    const backfilledDeposit = shouldBackfillDeposit
      ? await computeDepositAmount(order.supplierId, effectiveAmount)
      : null;

    await prisma.invoice.update({
      where: { id: existingInvoice.id },
      data: {
        photos: { push: renamedUrl },
        ...(inv.invoiceNumber ? { invoiceNumber: inv.invoiceNumber } : {}),
        ...(shouldCorrectAmount ? { amount: effectiveAmount } : {}),
        ...(backfilledDeposit ? { depositAmount: backfilledDeposit } : {}),
      },
    });

    const correctionLine = shouldCorrectAmount
      ? `\n💡 Amount corrected: RM ${storedAmount.toFixed(2)} → RM ${effectiveAmount.toFixed(2)} (delivery ${deliveryCharge ? `+RM ${deliveryCharge.toFixed(2)}` : "included"})`
      : "";
    const depositLine = backfilledDeposit
      ? `\n💡 Deposit required: RM ${backfilledDeposit.toFixed(2)}`
      : "";
    await sendMessage(
      chatId,
      `✅ <b>Invoice photo added</b>\n\nPO: ${order.orderNumber}\nSupplier: ${order.supplier?.name ?? "?"}\nAmount: RM ${effectiveAmount.toFixed(2)}\nInvoice #: ${inv.invoiceNumber ?? existingInvoice.id.slice(0, 8)}${correctionLine}${depositLine}\n\n📎 Uploaded to PO + Invoice`,
      msgId,
    );
  } else {
    // Create new invoice linked to PO. effectiveAmount = grand total incl.
    // delivery; deposit is computed off that so a supplier charging 10%
    // deposit on RM 105 (RM 100 items + RM 5 delivery) gets RM 10.50, not
    // RM 10.00.
    const invCount = await prisma.invoice.count();
    const invoiceNumber = inv.invoiceNumber || `INV-${String(invCount + 1).padStart(4, "0")}`;
    const depositAmount = await computeDepositAmount(order.supplierId, effectiveAmount);

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
        ...(depositAmount ? { depositAmount } : {}),
      },
    });

    const deliveryLine = deliveryCharge > 0 ? `\nDelivery: RM ${deliveryCharge.toFixed(2)}` : "";
    const depositLine = depositAmount ? `\nDeposit: RM ${depositAmount.toFixed(2)}` : "";
    await sendMessage(
      chatId,
      `✅ <b>Invoice created</b>\n\nPO: ${order.orderNumber}\nSupplier: ${order.supplier?.name ?? "?"}\nInvoice: ${invoiceNumber}\nAmount: RM ${effectiveAmount.toFixed(2)}${deliveryLine}${depositLine}\n\n📎 Uploaded to PO + Invoice`,
      msgId,
    );
  }
}
