import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// GET /api/hr/memos?userId=xxx&status=active|rescinded|all&type=...
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  const status = searchParams.get("status") || "active";
  const type = searchParams.get("type");

  let q = hrSupabaseAdmin
    .from("hr_memos")
    .select("*")
    .order("issued_at", { ascending: false })
    .limit(200);
  if (userId) q = q.contains("user_ids", [userId]);
  if (status !== "all") q = q.eq("status", status);
  if (type) q = q.eq("type", type);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with names — collect all user ids across recipient arrays + issuers
  const uids = Array.from(new Set(
    (data || []).flatMap((m) => [...(m.user_ids || []), m.issued_by]).filter(Boolean),
  ));
  const users = uids.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: uids } },
        select: { id: true, name: true, fullName: true },
      })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const nameOf = (id: string | null | undefined) =>
    id ? (userMap.get(id)?.fullName || userMap.get(id)?.name || null) : null;

  const enriched = (data || []).map((m) => ({
    ...m,
    user_names: (m.user_ids || []).map((id: string) => nameOf(id)).filter(Boolean),
    // Back-compat single-recipient fields
    user_id: m.user_ids?.[0] || m.user_id || null,
    user_name: nameOf(m.user_ids?.[0] || m.user_id),
    issued_by_name: nameOf(m.issued_by),
  }));

  return NextResponse.json({ memos: enriched });
}

// POST: issue a memo (to one or many staff)
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { user_id, user_ids, type, severity, title, body: memoBody, related_type, related_id } = body;
  const recipientIds: string[] = Array.isArray(user_ids) && user_ids.length > 0
    ? user_ids
    : user_id
      ? [user_id]
      : [];
  if (recipientIds.length === 0 || !type || !title || !memoBody) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!["announcement", "reminder", "commendation", "note", "verbal_warning", "written_warning"].includes(type)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  // MANAGER can only address memos to their own subtree (self + reports).
  if (session.role === "MANAGER") {
    const visibleIds = await resolveVisibleUserIds(session);
    const allowed = new Set([session.id, ...(visibleIds || [])]);
    const outsiders = recipientIds.filter((id) => !allowed.has(id));
    if (outsiders.length > 0) {
      return NextResponse.json(
        { error: `Forbidden — ${outsiders.length} recipient(s) outside your subtree` },
        { status: 403 },
      );
    }
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_memos")
    .insert({
      user_id: recipientIds[0], // back-compat single-recipient column
      user_ids: recipientIds,
      issued_by: session.id,
      type,
      severity: severity || "info",
      title,
      body: memoBody,
      related_type: related_type || "standalone",
      related_id: related_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memo: data });
}

// PATCH: rescind a memo
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, action, reason } = await req.json();
  if (!id || action !== "rescind") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Only OWNER/ADMIN can rescind any memo; MANAGER can only rescind memos
  // they themselves issued. Prevents cross-manager interference.
  if (session.role === "MANAGER") {
    const { data: existing } = await hrSupabaseAdmin
      .from("hr_memos")
      .select("issued_by")
      .eq("id", id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Memo not found" }, { status: 404 });
    }
    if (existing.issued_by !== session.id) {
      return NextResponse.json(
        { error: "Forbidden — you can only rescind memos you issued" },
        { status: 403 },
      );
    }
  }

  const { data, error } = await hrSupabaseAdmin
    .from("hr_memos")
    .update({
      status: "rescinded",
      rescinded_at: new Date().toISOString(),
      rescinded_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memo: data });
}
