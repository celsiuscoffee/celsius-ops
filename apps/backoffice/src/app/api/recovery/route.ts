import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { compensateReviewCase, isValidMyPhone } from "@/lib/reviews/recovery";
import { sendSMS, getActiveSmsProvider, providerAutoPrependsSender } from "@/lib/loyalty/sms";

export const dynamic = "force-dynamic";

// PUBLIC (no auth — the single-use recovery code is the credential).
// The customer reached this from the recovery link in our reply to their
// negative Google review.

// GET /api/recovery?code=XXXX — validate a code so the form can show state.
export async function GET(request: NextRequest) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
  if (!code) return NextResponse.json({ valid: false }, { status: 400 });

  const c = await prisma.reviewReplyDraft.findUnique({
    where: { recoveryCode: code },
    include: { outlet: { select: { name: true } } },
  });
  if (!c) return NextResponse.json({ valid: false });

  const claimed = c.status === "compensated" || c.status === "resolved";
  const usable = c.status === "approved";
  return NextResponse.json({
    valid: usable || claimed,
    claimed,
    usable,
    outletName: c.outlet.name,
  });
}

// POST /api/recovery — { code, phone, name } → capture + voucher.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!code) return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
  if (!isValidMyPhone(phone)) {
    return NextResponse.json({ ok: false, error: "Enter a valid Malaysian mobile number" }, { status: 400 });
  }

  const c = await prisma.reviewReplyDraft.findUnique({ where: { recoveryCode: code } });
  if (!c) return NextResponse.json({ ok: false, error: "That code isn't valid" }, { status: 404 });
  if (c.status === "compensated" || c.status === "resolved") {
    return NextResponse.json({ ok: true, alreadyClaimed: true, message: "You've already claimed this — see you soon!" });
  }
  if (c.status !== "approved") {
    return NextResponse.json({ ok: false, error: "This code is no longer active" }, { status: 410 });
  }

  const result = await compensateReviewCase(c.id, phone, name || null);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  // Best-effort SMS — on-screen confirmation is the primary delivery, so a
  // flaky provider never blocks the claim.
  try {
    const provider = await getActiveSmsProvider();
    const text = "Thank you for giving Celsius another chance — a free coffee is in your account. Show this at the till. We're sorry, and we'll do better.";
    const msg = providerAutoPrependsSender(provider) ? text : `RM0 [CelsiusCoffee] ${text}`;
    await sendSMS(phone, msg, { provider });
  } catch (err) {
    console.error("[recovery] SMS send failed (non-fatal):", err);
  }

  return NextResponse.json({
    ok: true,
    alreadyClaimed: result.alreadyCompensated,
    message: "Your free coffee is in your account — just give your phone number at the till.",
  });
}
