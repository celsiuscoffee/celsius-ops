import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sendOTP } from "@/lib/otp";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// Match every common stored shape — "+60123456789", "60123456789", "0123456789",
// "123456789", etc. — so the existing-member lookup doesn't miss a customer
// who originally signed up with a slightly different phone format.
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^0-9]/g, "");
  // Strip leading "60" (MY country code) if present so we can rebuild variants.
  const local = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0+/, "");
  return Array.from(new Set([
    raw.trim(),
    digits,
    `+${digits}`,
    local,
    `0${local}`,
    `60${local}`,
    `+60${local}`,
  ].filter(Boolean)));
}

/** Returns true when the supplied phone matches a member with at least
 *  one post-payment order. Used to decide whether to render the referral
 *  code field on the OTP screen — referral bonuses are only meant for
 *  genuinely new sign-ins (see attributeReferralOnSignup's not_new guard,
 *  which is the source of truth — this flag is a UX optimisation). */
async function isReturningCustomer(phone: string): Promise<boolean> {
  const variants = phoneVariants(phone);
  if (variants.length === 0) return false;

  const { data: memberRows } = await supabaseAdmin
    .from("members")
    .select("id")
    .in("phone", variants)
    .limit(5);
  const memberIds = (memberRows ?? []).map((r) => r.id as string);
  if (memberIds.length === 0) return false;

  const { count } = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .in("loyalty_id", memberIds)
    .in("status", ["preparing", "ready", "completed"]);
  return (count ?? 0) > 0;
}

// POST /api/loyalty/otp/send — legacy alias for /api/otp/send.
//
// Resolves natively (shared OTP store + SMS via @/lib/otp) instead of proxying
// to the loyalty app, so it no longer depends on loyalty.celsiuscoffee.com.
// Current clients call /api/otp/send directly; this stays as a thin back-compat
// endpoint for any older build still on the old path. The OTP store is the same
// shared Supabase the native route uses, so codes are interchangeable.
export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone) return NextResponse.json({ success: false, error: "Phone required" }, { status: 400 });

    // Rate-limit by phone (the loyalty endpoint used to enforce this).
    const rate = await checkRateLimit(phone, RATE_LIMITS.OTP_SEND);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: `Too many OTP requests. Try again in ${Math.ceil((rate.retryAfter || 300) / 60)} minutes.` },
        { status: 429 },
      );
    }

    // Probe the customer's account state in parallel with the OTP send so we
    // don't add latency to the SMS dispatch. `is_new_member` drives the OTP
    // screen's referral-code field visibility.
    const [data, returning] = await Promise.all([
      sendOTP(phone, "login"),
      isReturningCustomer(phone).catch(() => false),
    ]);
    return NextResponse.json({ ...data, is_new_member: !returning });
  } catch (err) {
    console.error("OTP send error:", err);
    return NextResponse.json({ success: false, error: "Failed to send OTP" }, { status: 500 });
  }
}
