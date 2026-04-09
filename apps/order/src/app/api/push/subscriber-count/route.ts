import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// GET /api/push/subscriber-count
// Returns { count: number } — total rows in push_subscriptions
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { count, error } = await supabase
      .from("push_subscriptions")
      .select("*", { count: "exact", head: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ count: count ?? 0 });
  } catch (err) {
    console.error("Subscriber count error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
