import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * Push-notification open tracking. Pickup-native calls this when the
 * app launches from a notification tap, passing the campaign_key and
 * the member_id. We mark the most recent send for that (campaign,
 * member) as opened so the backoffice can show open rate.
 *
 * Why match by campaign_key + member_id instead of a per-send token:
 *   - The notification payload already carries `data.type` (the
 *     campaign key); we don't have to mint a new opaque ID per send.
 *   - Members occasionally tap the same notification twice; the
 *     "most recent unopened send" lookup is idempotent and safe.
 *   - Notifications can sit in the OS centre for hours — we attribute
 *     to the actual send that triggered the visible row, not whatever
 *     happens to be the latest.
 *
 * Auth: a valid Authorization header from the customer's session
 * token. We don't trust the request to carry the right member_id —
 * we resolve it from the session.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const campaignKey: string | undefined = typeof body.campaignKey === "string" ? body.campaignKey : undefined;
    const memberId: string | undefined = typeof body.memberId === "string" ? body.memberId : undefined;

    if (!campaignKey || !memberId) {
      return NextResponse.json({ error: "campaignKey and memberId required" }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // Look up the most recent unopened send for this campaign + member
    // within the last 7 days. Bound the window so a long-tail open
    // (customer dug a notification out of the OS centre 3 weeks later)
    // doesn't attribute to a stale row that was already counted.
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: latest } = await supabase
      .from("notification_sends")
      .select("id")
      .eq("campaign_key", campaignKey)
      .eq("member_id", memberId)
      .is("opened_at", null)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      return NextResponse.json({ ok: true, matched: false });
    }

    await supabase
      .from("notification_sends")
      .update({ opened_at: new Date().toISOString() })
      .eq("id", (latest as { id: string }).id);

    return NextResponse.json({ ok: true, matched: true });
  } catch (err) {
    console.error("[push/track-open]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
