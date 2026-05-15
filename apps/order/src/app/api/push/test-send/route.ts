import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { sendExpoPush } from "@/lib/push/send";
import { tokensForPhone } from "@/lib/push/tokens";
import { renderTemplate } from "@/lib/push/render";

/**
 * Admin-only "test send" — fires a single push to one phone number
 * using the current draft (or saved) campaign template. Lets admins
 * preview tone + variable substitution on a real device before
 * enabling the campaign for real.
 *
 * Auth: requires CRON_SECRET in dev, falls back to a service-role-
 * only admin token in prod (the existing /api/loyalty/push-campaigns
 * routes already require backoffice auth, so a leak here would be a
 * separate route-level auth gap — we accept that risk for the test
 * send pattern and gate by the same cron secret pattern).
 *
 * Bypasses the campaign engine entirely:
 *   - no enabled / cap / opt-out / quiet-hours checks
 *   - no notification_sends row (so it doesn't pollute stats)
 *
 * Body:
 *   {
 *     phone: "+60123456789",
 *     campaignKey: "voucher_expiring",   // for fallback channel + deeplink
 *     title: "...",                      // draft (overrides DB)
 *     body:  "...",
 *     vars:  { rewardName: "Free Coffee", daysLeft: 2 },
 *   }
 */

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (bearer === expected) return true;
  // Backoffice forwards x-admin-secret on these privileged calls.
  if (req.headers.get("x-admin-secret") === expected) return true;
  return false;
}

const CHANNEL_FOR_KEY: Record<string, string> = {
  voucher_expiring: "loyalty",
  sitting_on_beans: "loyalty",
  lapsed_customer:  "promotions",
  birthday_treat:   "loyalty",
  tier_at_risk:     "loyalty",
};

const FALLBACK_DEEPLINK: Record<string, string> = {
  voucher_expiring: "rewards/vouchers",
  sitting_on_beans: "rewards",
  lapsed_customer:  "menu",
  birthday_treat:   "rewards/vouchers",
  tier_at_risk:     "rewards",
};

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const phone:       string | undefined = body.phone;
    const campaignKey: string | undefined = body.campaignKey;
    const titleDraft:  string | undefined = body.title;
    const bodyDraft:   string | undefined = body.body;
    const vars:        Record<string, string | number> = body.vars ?? {};

    if (!phone || !campaignKey) {
      return NextResponse.json({ error: "phone and campaignKey required" }, { status: 400 });
    }

    // Resolve title/body from drafts first, then DB. If neither is
    // present the test would render to "" — bail with a clear error.
    let title = titleDraft;
    let bodyText = bodyDraft;
    if (!title || !bodyText) {
      const supabase = getSupabaseAdmin();
      const { data: campaign } = await supabase
        .from("notification_campaigns")
        .select("title_template, body_template, deeplink_path")
        .eq("key", campaignKey)
        .maybeSingle();
      title    = title    ?? (campaign as { title_template?: string } | null)?.title_template ?? "";
      bodyText = bodyText ?? (campaign as { body_template?:  string } | null)?.body_template  ?? "";
    }

    if (!title || !bodyText) {
      return NextResponse.json(
        { error: "No template configured — enter a title + body first" },
        { status: 400 },
      );
    }

    const renderedTitle = renderTemplate(title, vars);
    const renderedBody  = renderTemplate(bodyText, vars);

    const tokens = await tokensForPhone(phone);
    if (tokens.length === 0) {
      return NextResponse.json(
        { error: `No push tokens registered for ${phone}. Open the app on this phone first.` },
        { status: 404 },
      );
    }

    const channel  = CHANNEL_FOR_KEY[campaignKey] ?? "loyalty";
    const deeplink = FALLBACK_DEEPLINK[campaignKey] ?? null;

    const result = await sendExpoPush(
      tokens.map((to) => ({
        to,
        title: renderedTitle,
        body:  renderedBody,
        sound: "default",
        channelId: channel,
        data: {
          type: campaignKey,
          ...(deeplink ? { deeplink } : {}),
          test: true,
        },
      })),
    );

    return NextResponse.json({
      ok: true,
      delivered: result.sent,
      failed:    result.failed,
      pruned:    result.pruned,
      preview:   { title: renderedTitle, body: renderedBody },
    });
  } catch (err) {
    console.error("[push/test-send]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
