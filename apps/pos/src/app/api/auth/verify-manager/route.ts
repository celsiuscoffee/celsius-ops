import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import bcryptjs from "bcryptjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: NextRequest) {
  const { pin } = await req.json();
  if (!pin || pin.length < 4) return NextResponse.json({ error: "PIN required" }, { status: 400 });

  const { data: managers } = await supabase
    .from("staff_users").select("id, name, pin_hash")
    .in("role", ["manager", "admin"]).eq("is_active", true);

  for (const user of managers ?? []) {
    if (user.pin_hash && await bcryptjs.compare(pin, user.pin_hash)) {
      return NextResponse.json({ ok: true, name: user.name });
    }
  }
  return NextResponse.json({ error: "Invalid manager PIN" }, { status: 401 });
}
