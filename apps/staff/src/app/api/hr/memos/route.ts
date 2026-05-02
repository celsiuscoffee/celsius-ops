import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/hr/memos — memos addressed to the signed-in user.
// Each memo carries `my_acknowledged_at` indicating whether THIS user has
// already acknowledged (read from hr_memo_acknowledgements join table). The
// legacy single `acknowledged_at` column on hr_memos is kept for backward
// compatibility but should be ignored by clients now.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("hr_memos")
    .select("*")
    .contains("user_ids", [session.id])
    .eq("status", "active")
    .order("issued_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const memoIds = (data || []).map((m) => m.id);
  // Lookup this user's acks for the visible memos. Single batched query.
  const { data: myAcks } = memoIds.length
    ? await supabase
        .from("hr_memo_acknowledgements")
        .select("memo_id, acknowledged_at, notes")
        .eq("user_id", session.id)
        .in("memo_id", memoIds)
    : { data: [] as Array<{ memo_id: string; acknowledged_at: string; notes: string | null }> };
  const ackMap = new Map((myAcks || []).map((a) => [a.memo_id, a]));

  const issuerIds = Array.from(new Set((data || []).map((m) => m.issued_by)));
  const issuers = issuerIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: issuerIds } },
        select: { id: true, name: true, fullName: true },
      })
    : [];
  const issuerMap = new Map(issuers.map((u) => [u.id, u]));

  const enriched = (data || []).map((m) => {
    const myAck = ackMap.get(m.id);
    return {
      ...m,
      issued_by_name: issuerMap.get(m.issued_by)?.fullName || issuerMap.get(m.issued_by)?.name || "Manager",
      my_acknowledged_at: myAck?.acknowledged_at ?? null,
      my_acknowledgement_notes: myAck?.notes ?? null,
    };
  });

  const unacknowledged = enriched.filter((m) => !m.my_acknowledged_at).length;
  return NextResponse.json({ memos: enriched, unacknowledgedCount: unacknowledged });
}

// PATCH /api/hr/memos — current user acknowledges a memo.
// body: { id, notes? }
// Idempotent upsert into hr_memo_acknowledgements.
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id, notes } = await req.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Verify the user is in fact a recipient. Without this, anyone with a
  // valid session could ack any memo by id.
  const { data: memo, error: memoErr } = await supabase
    .from("hr_memos")
    .select("id, user_ids, status")
    .eq("id", id)
    .maybeSingle();
  if (memoErr || !memo) return NextResponse.json({ error: "Memo not found" }, { status: 404 });
  if (memo.status !== "active") {
    return NextResponse.json({ error: "Memo no longer active" }, { status: 400 });
  }
  if (!Array.isArray(memo.user_ids) || !memo.user_ids.includes(session.id)) {
    return NextResponse.json({ error: "Not a recipient of this memo" }, { status: 403 });
  }

  const { data: ack, error } = await supabase
    .from("hr_memo_acknowledgements")
    .upsert(
      {
        memo_id: id,
        user_id: session.id,
        acknowledged_at: new Date().toISOString(),
        notes: notes || null,
      },
      { onConflict: "memo_id,user_id" },
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ack });
}
