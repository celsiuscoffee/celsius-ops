export const dynamic = "force-dynamic";

// Daily: drop a Birthday Drink voucher into the wallets of customers
// whose birthday falls within the current "birthday window".
//
// Default window = the customer's birthday week (Mon → Sun of the
// week containing their birthday). The voucher template id is
// configured per-brand under `app_config.birthday_voucher_template_id`
// (or fall back to a sensible default).
//
// Idempotent — a member only gets one birthday voucher per year,
// guarded by checking issued_rewards for source_type=birthday with
// source_ref_id = `birthday-${year}`.

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { cronRoute } from "@/lib/cron-monitor";
import { issueVoucher } from "@/lib/loyalty/v2";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

async function runBirthdayTreats() {
  const supabase = getSupabaseAdmin();

  // Birthday voucher template — admin-configured. Fail fast if missing.
  // AppConfig.value is jsonb so callers may store either a bare string or
  // an object; unwrap both shapes so the row format isn't load-bearing.
  const { data: cfg } = await supabase
    .from("AppConfig")
    .select("value")
    .eq("key", "birthday_voucher_template_id")
    .maybeSingle();
  const raw = cfg?.value as unknown;
  const templateId =
    typeof raw === "string" ? raw
      : (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>))
        ? String((raw as Record<string, unknown>).value)
        : null;
  if (!templateId) {
    return NextResponse.json(
      { error: "birthday_voucher_template_id not configured in AppConfig" },
      { status: 503 },
    );
  }

  const today = new Date();
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const year = today.getUTCFullYear();

  // Find members whose birthday matches today (month+day match, ignore year).
  // Birthday is stored on the members table as `brand_data->>birthday` (ISO).
  const { data: members } = await supabase
    .from("members")
    .select("id, brand_data")
    .eq("brand_id", BRAND_ID);

  type MemberRow = { id: string; brand_data: { birthday?: string | null } | null };
  const candidates: string[] = [];
  for (const m of (members ?? []) as MemberRow[]) {
    const bday = m.brand_data?.birthday;
    if (!bday) continue;
    const d = new Date(bday);
    if (d.getUTCMonth() + 1 === month && d.getUTCDate() === day) {
      candidates.push(m.id);
    }
  }

  let issued = 0;
  for (const memberId of candidates) {
    const sourceRefId = `birthday-${year}`;
    // Idempotency check.
    const { data: existing } = await supabase
      .from("issued_rewards")
      .select("id")
      .eq("member_id", memberId)
      .eq("source_type", "birthday")
      .eq("source_ref_id", sourceRefId)
      .maybeSingle();
    if (existing) continue;

    const v = await issueVoucher({
      memberId,
      templateId,
      sourceType: "birthday",
      sourceRefId,
    });
    if (v) issued++;
  }

  return NextResponse.json({ candidates: candidates.length, issued });
}

export const GET = cronRoute("birthday-treats", runBirthdayTreats);
