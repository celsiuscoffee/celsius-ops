import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET - fetch notifications, optionally filtered by brand_id
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const brandId = request.nextUrl.searchParams.get("brand_id");

  let query = supabaseAdmin
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false });

  if (brandId) {
    query = query.eq("brand_id", brandId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - create notification
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const { message, channel, audience, status, scheduled_at, brand_id } = body;

    if (!message || !channel) {
      return NextResponse.json({ error: "message and channel required" }, { status: 400 });
    }

    const id = `notif-${Date.now()}`;
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .insert({
        id,
        message,
        channel,
        audience: audience || "All members",
        sent: status === "sent" ? 0 : null,
        delivered: status === "sent" ? 0 : null,
        status: status || "draft",
        scheduled_at: scheduled_at || null,
        brand_id: brand_id || "brand-celsius",
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 });
  }
}

// DELETE - delete notification
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabaseAdmin.from("notifications").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
