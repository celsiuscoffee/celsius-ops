import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth, hashPin } from "@/lib/auth";

// POST /api/staff/create — create a new staff member (requires admin auth)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { name, email, phone, outlet_id, outlet_ids, role, pin, brand_id } = body;

    if (!name || !pin) {
      return NextResponse.json(
        { success: false, error: "name and pin are required" },
        { status: 400 }
      );
    }

    // Hash PIN before storing
    const hashedPin = await hashPin(pin);

    const resolvedOutletIds = outlet_ids || (outlet_id ? [outlet_id] : []);
    const id = `staff-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from("staff_users")
      .insert({
        id,
        brand_id: brand_id || "brand-celsius",
        outlet_id: resolvedOutletIds[0] || null,
        outlet_ids: resolvedOutletIds,
        name,
        email: email || null,
        role: role || "staff",
        pin_hash: hashedPin,
        is_active: true,
      })
      .select("id, brand_id, outlet_id, outlet_ids, name, email, role, is_active, created_at")
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, staff: data });
  } catch {
    return NextResponse.json(
      { success: false, error: "Failed to create staff" },
      { status: 500 }
    );
  }
}
