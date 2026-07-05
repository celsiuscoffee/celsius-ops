export const dynamic = "force-dynamic";

// Daily voucher lifecycle cron — does TWO things in one sweep:
//   1) Notify customers about vouchers expiring in ~2 days so they
//      have time to plan a redemption.
//   2) Mark already-expired vouchers as status='expired' so they
//      stop showing up in customer wallets and stop being checked
//      every day. The notify-only previous version left stale
//      `status='active' AND expires_at < now()` rows accumulating
//      forever — confusing customers + polluting analytics.

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cronRoute } from "@/lib/cron-monitor";
import { notifyVoucherExpiringSoon } from "@/lib/push/templates";

async function runVoucherExpiring() {
  const supabase = getSupabaseAdmin();

  // ── 1) Sweep already-expired vouchers ─────────────────────────────
  // Runs first so we don't bother notifying about a voucher that's
  // already past expiry (rare race condition but possible).
  const { data: expired, error: expireErr } = await supabase
    .from("issued_rewards")
    .update({ status: "expired" })
    .eq("status", "active")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  if (expireErr) {
    console.error("[voucher-expiring] sweep failed", expireErr);
  }
  const sweptCount = expired?.length ?? 0;

  // ── 2) Notify about upcoming expiry ───────────────────────────────
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const end   = new Date(Date.now() + 60 * 60 * 60 * 1000).toISOString();

  const { data: vouchers } = await supabase
    .from("issued_rewards")
    .select("id, member_id, title, expires_at")
    .eq("status", "active")
    .gte("expires_at", start)
    .lt("expires_at", end);

  let sent = 0;
  for (const v of vouchers ?? []) {
    const daysLeft = Math.max(
      1,
      Math.ceil((new Date(v.expires_at as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
    const r = await notifyVoucherExpiringSoon({
      memberId: v.member_id as string,
      voucherTitle: (v.title as string) ?? "Your voucher",
      daysLeft,
    });
    if ((r.sent ?? 0) > 0) sent++;
  }

  return NextResponse.json({
    swept_to_expired: sweptCount,
    checked: vouchers?.length ?? 0,
    sent,
  });
}

export const GET = cronRoute("voucher-expiring", runVoucherExpiring);
