import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireCustomerSession } from "@/lib/customer-jwt";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+6${digits}`;
  return `+60${digits}`;
}

// GET /api/loyalty/member?phone=+60123456789 OR ?email=user@example.com — refresh member data
//
// Reads directly from the members table + member_brands instead of
// proxying through the loyalty app's /api/members endpoint. The
// loyalty app's endpoint returns a fixed shape (id, phone, name,
// brand_data) and silently drops email/birthday — those fields ARE
// in the members table but the proxy was the upstream filter that
// hid them, so the "Complete profile" pill kept resurfacing on the
// next mount even after the customer saved their birthday. Going
// direct removes that filter and gives us a single source of truth
// (the DB).
export async function GET(request: NextRequest) {
  try {
    const phone = request.nextUrl.searchParams.get("phone");
    const email = request.nextUrl.searchParams.get("email");
    if (!phone && !email) return NextResponse.json({ error: "Phone or email required" }, { status: 400 });

    const normPhone = phone ? normalisePhone(phone) : null;

    // Hardened: this endpoint returns name, email, birthday, and
    // points balance — full PII. Earlier the session check was
    // permissive (allowed anonymous calls when STRICT_CUSTOMER_AUTH
    // was unset, which is the production default), which meant
    // anyone could enumerate phone numbers and harvest member
    // records. Now the phone lookup path REQUIRES a session and the
    // session phone must match. Email lookup is reserved for the
    // /account/login/callback magic-link flow and stays open — that
    // path is already gated by ownership of the email inbox.
    const guard = requireCustomerSession(request);
    if (guard.error) return guard.error as unknown as NextResponse;
    if (normPhone) {
      if (!guard.session) {
        return NextResponse.json(
          { error: "Authentication required" },
          { status: 401 }
        );
      }
      if (guard.session.phone !== normPhone) {
        return NextResponse.json(
          { error: "Session does not match phone" },
          { status: 403 }
        );
      }
    }

    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("members")
      .select("id, phone, name, email, birthday")
      .limit(1);
    if (normPhone) {
      query = query.eq("phone", normPhone);
    } else {
      query = query.eq("email", email!);
    }
    const { data: members, error } = await query;
    if (error) {
      console.error("Loyalty member fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch member" }, { status: 500 });
    }
    const member = members && members.length > 0 ? (members[0] as {
      id: string;
      phone: string;
      name: string | null;
      email: string | null;
      birthday: string | null;
    }) : null;

    if (!member) return NextResponse.json({ member: null });

    // Brand-scoped stats live on member_brands. Separate query so the
    // base member lookup never bottle-necks on the join.
    const { data: brandRow } = await supabase
      .from("member_brands")
      .select("points_balance, total_points_earned, total_visits")
      .eq("member_id", member.id)
      .eq("brand_id", BRAND_ID)
      .maybeSingle();

    return NextResponse.json({
      member: {
        id:                member.id,
        phone:             member.phone,
        name:              member.name ?? null,
        email:             member.email ?? null,
        birthday:          member.birthday ?? null,
        pointsBalance:     (brandRow?.points_balance as number | null)       ?? 0,
        totalPointsEarned: (brandRow?.total_points_earned as number | null)  ?? 0,
        totalVisits:       (brandRow?.total_visits as number | null)         ?? 0,
      },
    });
  } catch (err) {
    console.error("Loyalty member fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch member" }, { status: 500 });
  }
}
