import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * POST /api/staff/update
 * Update a staff member (name, email, outlet, role, active status)
 * Body: { staff_id, name?, email?, outlet_id?, role?, is_active? }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { staff_id, ...updates } = body;

    if (!staff_id) {
      return NextResponse.json(
        { success: false, error: "staff_id is required" },
        { status: 400 }
      );
    }

    // Only allow specific fields to be updated
    const allowed: Record<string, unknown> = {};
    if (updates.name !== undefined) allowed.name = updates.name;
    if (updates.email !== undefined) allowed.email = updates.email;
    if (updates.outlet_id !== undefined) allowed.outlet_id = updates.outlet_id;
    if (updates.outlet_ids !== undefined) allowed.outlet_ids = updates.outlet_ids;
    if (updates.role !== undefined) allowed.role = updates.role;
    if (updates.is_active !== undefined) allowed.is_active = updates.is_active;

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json(
        { success: false, error: "No fields to update" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("staff_users")
      .update(allowed)
      .eq("id", staff_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, staff: data });
  } catch (error) {
    console.error("Staff update error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update staff" },
      { status: 500 }
    );
  }
}
