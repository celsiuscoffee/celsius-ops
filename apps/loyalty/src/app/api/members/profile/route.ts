import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * PUT /api/members/profile
 *
 * Customer self-service profile update.
 * Auth: requires phone + member_id to match (customer already OTP-verified).
 * Rate limited: 10 updates per 10 minutes per phone.
 *
 * Body: { member_id, phone, name?, email?, birthday? }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { member_id, phone, name, email, birthday } = body;

    if (!member_id || !phone) {
      return NextResponse.json(
        { error: "member_id and phone are required" },
        { status: 400 }
      );
    }

    // Validate input types
    if (typeof member_id !== "string" || typeof phone !== "string") {
      return NextResponse.json(
        { error: "Invalid input types" },
        { status: 400 }
      );
    }

    // Rate limit by phone to prevent brute-force enumeration
    const rateCheck = await checkRateLimit(phone, RATE_LIMITS.PROFILE_UPDATE);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // Verify the phone matches the member — this is the customer's auth proof
    // (they already OTP-verified this phone to reach the dashboard)
    const { data: member, error: lookupError } = await supabaseAdmin
      .from("members")
      .select("id, phone")
      .eq("id", member_id)
      .single();

    if (lookupError || !member) {
      // Return generic error to prevent member_id enumeration
      return NextResponse.json(
        { error: "Unable to update profile" },
        { status: 403 }
      );
    }

    // Normalize phones for comparison
    const normalize = (p: string) => p.replace(/\D/g, "").replace(/^0/, "60");
    if (normalize(member.phone) !== normalize(phone)) {
      // Return same generic error to prevent enumeration
      return NextResponse.json(
        { error: "Unable to update profile" },
        { status: 403 }
      );
    }

    // Build whitelisted updates — only name, email, birthday allowed
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      const trimmed = typeof name === "string" ? name.trim().slice(0, 100) : "";
      updates.name = trimmed || null;
    }
    if (email !== undefined) {
      const trimmed = typeof email === "string" ? email.trim().slice(0, 200) : "";
      // Basic email validation
      if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 }
        );
      }
      updates.email = trimmed || null;
    }
    if (birthday !== undefined) {
      // Validate date format (YYYY-MM-DD)
      const trimmed = typeof birthday === "string" ? birthday.trim() : "";
      if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return NextResponse.json(
          { error: "Invalid birthday format" },
          { status: 400 }
        );
      }
      updates.birthday = trimmed || null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("members")
      .update(updates)
      .eq("id", member_id)
      .select("id, phone, name, email, birthday")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Failed to update profile" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, member: data });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
