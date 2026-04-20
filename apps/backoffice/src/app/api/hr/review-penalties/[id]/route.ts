import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { resolveVisibleUserIds } from "@/lib/hr/scope";

export const dynamic = "force-dynamic";

// PATCH /api/hr/review-penalties/:id
// Body: { action: "apply"|"dismiss", userIds?: string[], penaltyAmount?: number, dismissReason?: string }
// - apply: sets status=applied, attributed_user_ids=userIds, penalty_amount=penaltyAmount
// - dismiss: sets status=dismissed, dismiss_reason
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!["OWNER", "ADMIN", "MANAGER"].includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action, userIds, penaltyAmount, dismissReason } = body as {
    action: "apply" | "dismiss";
    userIds?: string[];
    penaltyAmount?: number;
    dismissReason?: string;
  };

  if (action === "apply") {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds required" }, { status: 400 });
    }

    // MANAGER: attributed userIds must all be in subtree.
    if (session.role === "MANAGER") {
      const visibleIds = await resolveVisibleUserIds(session);
      const allowed = new Set(visibleIds || []);
      const outOfScope = userIds.filter((u) => !allowed.has(u));
      if (outOfScope.length > 0) {
        return NextResponse.json(
          { error: "Forbidden — one or more users are outside your subtree" },
          { status: 403 },
        );
      }
    }
    const { data, error } = await hrSupabaseAdmin
      .from("hr_review_penalty")
      .update({
        status: "applied",
        attributed_user_ids: userIds,
        penalty_amount: typeof penaltyAmount === "number" && penaltyAmount >= 0 ? penaltyAmount : 50,
        reviewed_by: session.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        dismiss_reason: null,
      })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found or already actioned" }, { status: 404 });
    return NextResponse.json({ item: data });
  }

  if (action === "dismiss") {
    const { data, error } = await hrSupabaseAdmin
      .from("hr_review_penalty")
      .update({
        status: "dismissed",
        dismiss_reason: dismissReason || null,
        reviewed_by: session.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found or already actioned" }, { status: 404 });
    return NextResponse.json({ item: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
