import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();

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

// POST /api/loyalty/otp/send — proxy to loyalty app
export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone) return NextResponse.json({ success: false, error: "Phone required" }, { status: 400 });

    // Probe the customer's account state in parallel with the OTP send so
    // we don't add latency to the SMS dispatch. The response carries
    // `is_new_member` so the OTP screen can conditionally render the
    // referral-code field.
    const [proxyRes, returning] = await Promise.all([
      fetch(`${LOYALTY_BASE}/api/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, purpose: "login" }),
      }),
      isReturningCustomer(phone).catch(() => false),
    ]);

    const data = await proxyRes.json();
    return NextResponse.json(
      { ...data, is_new_member: !returning },
      { status: proxyRes.status },
    );
  } catch (err) {
    console.error("Loyalty OTP send error:", err);
    return NextResponse.json({ success: false, error: "Failed to send OTP" }, { status: 500 });
  }
}
