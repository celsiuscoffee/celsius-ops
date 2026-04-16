import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET: my availability records
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || new Date().toISOString().slice(0, 10);
  const toDate = new Date(from);
  toDate.setMonth(toDate.getMonth() + 3);
  const to = searchParams.get("to") || toDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("hr_staff_availability")
    .select("*")
    .eq("user_id", session.id)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ availability: data || [] });
}

// POST: set/toggle availability for a date
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { date, availability, reason } = body as {
    date: string;
    availability: "unavailable" | "preferred" | "available";
    reason?: string;
  };

  if (!date || !availability) {
    return NextResponse.json({ error: "date and availability required" }, { status: 400 });
  }

  // Don't allow setting blockout dates in the past
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) {
    return NextResponse.json({ error: "Cannot set availability for past dates" }, { status: 400 });
  }

  // Upsert
  const { data, error } = await supabase
    .from("hr_staff_availability")
    .upsert(
      {
        user_id: session.id,
        date,
        availability,
        reason: reason || null,
      },
      { onConflict: "user_id,date" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ availability: data });
}

// DELETE: remove an availability record
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const { error } = await supabase
    .from("hr_staff_availability")
    .delete()
    .eq("user_id", session.id)
    .eq("date", date);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
