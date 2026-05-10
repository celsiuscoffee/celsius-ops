import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { readCustomerSession } from "@/lib/customer-jwt";

/**
 * POST /api/members/delete
 *
 * Customer self-service account deletion (Apple App Store guideline 5.1.1).
 * Auth: requires phone + member_id to match (customer already OTP-verified).
 * Rate limited: 3 deletions per hour per phone.
 *
 * Side effects:
 * - sms_logs.member_id is set NULL (logs retained 90 days for audit, anonymised)
 * - otp_codes for the phone are purged
 * - members row is deleted; FK cascades remove member_brands, point_transactions,
 *   redemptions, issued_rewards
 *
 * Body: { member_id, phone }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { member_id, phone } = body;

    if (!member_id || !phone) {
      return NextResponse.json(
        { error: "member_id and phone are required" },
        { status: 400 }
      );
    }

    if (typeof member_id !== "string" || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    // Customer session check. New pickup-native builds send a Bearer
    // token issued at OTP verify; the body's `phone` and `member_id`
    // must match the signed payload, otherwise anyone who guesses a
    // phone number can wipe that account. Old builds without a token
    // fall through to the rate-limit + DB-match path below — the
    // token becomes mandatory once the OTA propagates and we flip
    // to fail-closed.
    const session = readCustomerSession(request);
    if (session && session.phone !== phone) {
      return NextResponse.json(
        { error: "Session does not match the supplied phone" },
        { status: 403 }
      );
    }

    const rateCheck = await checkRateLimit(phone, RATE_LIMITS.ACCOUNT_DELETE);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    const { data: member, error: lookupError } = await supabaseAdmin
      .from("members")
      .select("id, phone")
      .eq("id", member_id)
      .single();

    if (lookupError || !member) {
      return NextResponse.json(
        { error: "Unable to delete account" },
        { status: 403 }
      );
    }

    const normalize = (p: string) => p.replace(/\D/g, "").replace(/^0/, "60");
    const normalizedPhone = normalize(phone);
    if (normalize(member.phone) !== normalizedPhone) {
      return NextResponse.json(
        { error: "Unable to delete account" },
        { status: 403 }
      );
    }

    // Anonymise SMS logs — preserve audit trail per privacy policy (90-day retention)
    // but break the link to the deleted member.
    const { error: smsErr } = await supabaseAdmin
      .from("sms_logs")
      .update({ member_id: null })
      .eq("member_id", member_id);
    if (smsErr) {
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    // Purge any OTP codes associated with the phone (linked by phone string, not FK)
    await supabaseAdmin
      .from("otp_codes")
      .delete()
      .eq("phone", member.phone);

    // Anonymise the customer phone on prior orders. The orders row
    // itself is retained (financial / accounting requirement) but
    // every link back to a real person is severed. Hits both
    // canonical phone shapes the API may have written.
    const phoneShapes = [member.phone, normalizedPhone, "+" + normalizedPhone];
    for (const p of phoneShapes) {
      await supabaseAdmin
        .from("orders")
        .update({ customer_phone: null, loyalty_phone: null, customer_name: null, customer_email: null })
        .or(`customer_phone.eq.${p},loyalty_phone.eq.${p}`);
    }

    // Drop every Expo push token the member registered so a stranger
    // who later signs in on the same device doesn't inherit the
    // deleted account's order pushes.
    await supabaseAdmin
      .from("expo_push_tokens")
      .delete()
      .or(`member_id.eq.${member_id},phone.eq.${member.phone}`);

    // Delete the member — cascades to member_brands, point_transactions, redemptions, issued_rewards
    const { error: deleteErr } = await supabaseAdmin
      .from("members")
      .delete()
      .eq("id", member_id);

    if (deleteErr) {
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
