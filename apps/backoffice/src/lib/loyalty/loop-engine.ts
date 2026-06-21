// ============================================================================
// SMS marketing LOOP ENGINE — multi-arm reactivation/frequency campaigns with a
// holdout control, rewards auto-tagged to the member, and honest attribution.
// See docs/design/sms-loop-engineering.md.
//
// Lifecycle of a round:
//   prepareWinbackRound()  → segment + split (holdout + arms) + issue rewards +
//                            log assignments. Status 'prepared'. NO SMS yet.
//   sendRound()            → after owner approval, fire the SMS per arm.
//   measureRound()         → after the window, compute per-arm redemption +
//                            order lift vs holdout. Status 'measured'.
// ============================================================================

import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { sendSMS } from "@/lib/loyalty/sms";

const BRAND = "brand-celsius";
const SMS_COST_RM = 0.1; // SMS Niaga ~RM0.10/SMS

export type ArmDef = {
  key: string; // e.g. 'free_tea'
  label: string; // e.g. 'Free Tea'
  voucher_template_id: string; // voucher_templates.id to issue
  message: string; // SMS body (may contain {name})
};

type SegmentRow = { member_id: string; phone: string; name: string | null };

function rid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Segment: lapsed members (last visit between min..max days ago) with a phone.
async function lapsedSegment(minDays: number, maxDays: number): Promise<SegmentRow[]> {
  const sinceMax = new Date(Date.now() - maxDays * 86400000).toISOString();
  const sinceMin = new Date(Date.now() - minDays * 86400000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("member_brands")
    .select("member_id, members!inner(id, phone, name)")
    .eq("brand_id", BRAND)
    .gte("last_visit_at", sinceMax)
    .lt("last_visit_at", sinceMin);
  if (error) throw new Error(`segment query: ${error.message}`);

  const rows: SegmentRow[] = [];
  const seen = new Set<string>();
  for (const r of (data ?? []) as unknown as Array<{ member_id: string; members: { id: string; phone: string | null; name: string | null } }>) {
    const phone = (r.members?.phone ?? "").trim();
    if (!phone) continue; // unreachable
    if (seen.has(phone)) continue; // dedupe by phone
    seen.add(phone);
    rows.push({ member_id: r.member_id, phone, name: r.members?.name ?? null });
  }
  return rows;
}

// Fisher–Yates with a seeded-ish shuffle (index-varied; Math.random is fine here).
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function issueReward(memberId: string, templateId: string, roundId: string): Promise<{ id: string; cogsRm: number } | null> {
  const { data: tpl } = await supabaseAdmin
    .from("voucher_templates")
    .select(`id, title, description, icon, category, validity_days, discount_type, discount_value, min_order_value, applicable_categories, applicable_products, free_product_name, stacks_with_beans`)
    .eq("id", templateId)
    .eq("brand_id", BRAND)
    .eq("is_active", true)
    .single();
  if (!tpl) return null;

  const id = rid("ir");
  const expiresAt = tpl.validity_days
    ? new Date(Date.now() + (tpl.validity_days as number) * 86400000).toISOString()
    : null;

  const { error } = await supabaseAdmin.from("issued_rewards").insert({
    id,
    brand_id: BRAND,
    member_id: memberId,
    voucher_template_id: tpl.id,
    source_type: "campaign",
    source_ref_id: roundId, // ties the reward to this loop round for attribution
    title: tpl.title,
    description: tpl.description,
    icon: tpl.icon,
    category: tpl.category,
    discount_type: tpl.discount_type,
    discount_value: tpl.discount_value,
    min_order_value: tpl.min_order_value,
    applicable_categories: tpl.applicable_categories,
    applicable_products: tpl.applicable_products,
    free_product_name: tpl.free_product_name,
    stacks_with_beans: tpl.stacks_with_beans ?? true,
    status: "active",
    issued_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  if (error) return null;
  // free_item COGS is a rough estimate; refine per-product later.
  const cogsRm = tpl.discount_type === "free_item" ? 1.5 : 0;
  return { id, cogsRm };
}

// ── PREPARE ─────────────────────────────────────────────────────────────────
// Builds the round: segment → holdout + arm split → issue rewards for treatment
// → log every assignment. Returns a preview for owner approval. No SMS sent.
export async function prepareWinbackRound(opts: {
  arms: ArmDef[];
  holdoutPct?: number;
  minDaysLapsed?: number;
  maxDaysLapsed?: number;
  attributionWindowDays?: number;
  createdBy?: string;
  suppressPhones?: string[]; // PDPA opt-outs / recent contacts
  maxRecipients?: number; // cap total segment size to fit an SMS budget (start small, scale later)
}) {
  const holdoutPct = opts.holdoutPct ?? 20;
  const minD = opts.minDaysLapsed ?? 30;
  const maxD = opts.maxDaysLapsed ?? 60;
  const windowDays = opts.attributionWindowDays ?? 7;
  const arms = opts.arms;
  if (!arms.length) throw new Error("at least one arm required");

  const suppress = new Set((opts.suppressPhones ?? []).map((p) => p.trim()));
  let segment = await lapsedSegment(minD, maxD);
  segment = segment.filter((m) => !suppress.has(m.phone));
  segment = shuffle(segment);
  // Budget cap — take the first N of the shuffled (random) segment so the
  // SMS spend stays within the chosen budget. Scaling later = raise the cap.
  const rawReach = segment.length;
  const capped = !!(opts.maxRecipients && opts.maxRecipients > 0 && opts.maxRecipients < rawReach);
  if (capped) segment = segment.slice(0, opts.maxRecipients);

  // next round number for this loop
  const { data: last } = await supabaseAdmin
    .from("loop_rounds")
    .select("round_no")
    .eq("loop_key", "winback")
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const roundNo = (last?.round_no ?? 0) + 1;
  const roundId = rid("lr");

  // split: holdout first, then round-robin across arms
  const holdoutN = Math.round((segment.length * holdoutPct) / 100);
  const holdout = segment.slice(0, holdoutN);
  const treatment = segment.slice(holdoutN);

  const segmentLabel = `Lapsed ${minD}–${maxD}d (${segment.length} reachable, ${holdoutPct}% holdout)${capped ? ` · budget-capped from ${rawReach}` : ""}`;

  await supabaseAdmin.from("loop_rounds").insert({
    id: roundId,
    brand_id: BRAND,
    loop_key: "winback",
    round_no: roundNo,
    segment_label: segmentLabel,
    holdout_pct: holdoutPct,
    arms: arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message })),
    attribution_window_days: windowDays,
    status: "prepared",
    created_by: opts.createdBy ?? null,
  });

  const armCounts: Record<string, number> = {};
  let rewardCogs = 0;

  // holdout assignments (no reward, no SMS)
  const holdoutRows = holdout.map((m) => ({
    id: rid("la"),
    round_id: roundId,
    member_id: m.member_id,
    phone: m.phone,
    arm: "holdout",
  }));
  if (holdoutRows.length) await supabaseAdmin.from("loop_assignments").insert(holdoutRows);
  armCounts["holdout"] = holdoutRows.length;

  // treatment: round-robin, issue reward, log assignment
  for (let i = 0; i < treatment.length; i++) {
    const m = treatment[i];
    const arm = arms[i % arms.length];
    const issued = await issueReward(m.member_id, arm.voucher_template_id, roundId);
    if (issued) rewardCogs += issued.cogsRm;
    await supabaseAdmin.from("loop_assignments").insert({
      id: rid("la"),
      round_id: roundId,
      member_id: m.member_id,
      phone: m.phone,
      arm: arm.key,
      issued_reward_id: issued?.id ?? null,
    });
    armCounts[arm.key] = (armCounts[arm.key] ?? 0) + 1;
  }

  const treatmentN = treatment.length;
  return {
    round_id: roundId,
    round_no: roundNo,
    segment_label: segmentLabel,
    total: segment.length,
    holdout: holdoutRows.length,
    arm_counts: armCounts,
    est_sms_cost_rm: +(treatmentN * SMS_COST_RM).toFixed(2),
    est_reward_cogs_rm: +rewardCogs.toFixed(2),
    status: "prepared" as const,
  };
}

// ── SEND ─────────────────────────────────────────────────────────────────────
// Fire the SMS for every treatment assignment (holdout gets nothing). Idempotent
// per assignment (skips ones already sent). Call only after owner approval.
export async function sendRound(roundId: string) {
  const { data: round } = await supabaseAdmin.from("loop_rounds").select("*").eq("id", roundId).single();
  if (!round) throw new Error("round not found");
  if (round.status === "sent" || round.status === "measured") throw new Error(`round already ${round.status}`);

  const armMsg: Record<string, string> = {};
  for (const a of (round.arms as ArmDef[])) armMsg[a.key] = a.message;

  const { data: rows } = await supabaseAdmin
    .from("loop_assignments")
    .select("id, phone, arm, sms_status")
    .eq("round_id", roundId)
    .neq("arm", "holdout");

  let sent = 0;
  let failed = 0;
  for (const r of (rows ?? []) as Array<{ id: string; phone: string; arm: string; sms_status: string | null }>) {
    if (r.sms_status === "sent") continue; // idempotent
    const message = armMsg[r.arm] ?? "";
    if (!message) { failed++; continue; }
    const res = await sendSMS(r.phone, message); // provider resolved from app_settings toggle
    await supabaseAdmin
      .from("loop_assignments")
      .update({ sms_status: res.success ? "sent" : "failed", sms_message_id: res.messageId ?? null })
      .eq("id", r.id);
    if (res.success) sent++; else failed++;
  }

  await supabaseAdmin
    .from("loop_rounds")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", roundId);

  return { round_id: roundId, sent, failed };
}

// ── MEASURE ───────────────────────────────────────────────────────────────────
// After the attribution window, compute per-arm conversion vs the holdout.
// converted = placed an order (orders OR pos_orders) after assignment;
// redeemed  = the issued reward was redeemed. Lift = arm rate − holdout rate.
export async function measureRound(roundId: string) {
  const { data: round } = await supabaseAdmin.from("loop_rounds").select("*").eq("id", roundId).single();
  if (!round) throw new Error("round not found");

  const { data: rows } = await supabaseAdmin
    .from("loop_assignments")
    .select("id, phone, arm, issued_reward_id, assigned_at")
    .eq("round_id", roundId);

  const windowMs = (round.attribution_window_days as number) * 86400000;

  type Acc = { n: number; converted: number; redeemed: number; revenueRm: number };
  const byArm: Record<string, Acc> = {};

  for (const r of (rows ?? []) as Array<{ id: string; phone: string; arm: string; issued_reward_id: string | null; assigned_at: string }>) {
    const acc = (byArm[r.arm] ??= { n: 0, converted: 0, redeemed: 0, revenueRm: 0 });
    acc.n++;

    const start = new Date(r.assigned_at).toISOString();
    const end = new Date(new Date(r.assigned_at).getTime() + windowMs).toISOString();

    // orders by phone in the window (online + POS)
    const [{ data: o1 }, { data: o2 }] = await Promise.all([
      supabaseAdmin.from("orders").select("total").eq("customer_phone", r.phone).gte("created_at", start).lte("created_at", end),
      supabaseAdmin.from("pos_orders").select("total").eq("customer_phone", r.phone).gte("created_at", start).lte("created_at", end),
    ]);
    const orders = [...(o1 ?? []), ...(o2 ?? [])] as Array<{ total: number | null }>;
    if (orders.length) {
      acc.converted++;
      acc.revenueRm += orders.reduce((s, o) => s + (o.total ?? 0), 0) / 100; // total is cents
    }

    let thisRedeemed = false;
    if (r.issued_reward_id) {
      const { data: ir } = await supabaseAdmin.from("issued_rewards").select("redeemed_at, status").eq("id", r.issued_reward_id).maybeSingle();
      thisRedeemed = !!(ir?.redeemed_at || ir?.status === "redeemed");
      if (thisRedeemed) acc.redeemed++;
    }

    await supabaseAdmin
      .from("loop_assignments")
      .update({
        converted: orders.length > 0,
        reward_redeemed: thisRedeemed,
        order_revenue: orders.reduce((s, o) => s + (o.total ?? 0), 0) / 100,
      })
      .eq("id", r.id);
  }

  const holdoutRate = byArm["holdout"] ? byArm["holdout"].converted / Math.max(1, byArm["holdout"].n) : 0;

  const stats = Object.entries(byArm).map(([arm, a]) => {
    const convRate = a.converted / Math.max(1, a.n);
    const redeemRate = a.redeemed / Math.max(1, a.n);
    const liftPp = arm === "holdout" ? 0 : +((convRate - holdoutRate) * 100).toFixed(1);
    const marginPerRecipientRm = +(a.revenueRm / Math.max(1, a.n)).toFixed(2); // gross; subtract COGS/SMS in dashboard
    return { arm, n: a.n, conversion_rate: +(convRate * 100).toFixed(1), redemption_rate: +(redeemRate * 100).toFixed(1), lift_pp: liftPp, revenue_rm: +a.revenueRm.toFixed(2), revenue_per_recipient_rm: marginPerRecipientRm };
  });

  await supabaseAdmin
    .from("loop_rounds")
    .update({ status: "measured", measured_at: new Date().toISOString(), stats })
    .eq("id", roundId);

  return { round_id: roundId, holdout_conversion_rate: +(holdoutRate * 100).toFixed(1), stats };
}
