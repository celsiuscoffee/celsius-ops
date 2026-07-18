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
import { sendSMS, getActiveSmsProvider } from "@/lib/loyalty/sms";
import { pushTokensByMember, sendPushToTokens } from "@/lib/loyalty/push";

const BRAND = "brand-celsius";
const SMS_COST_RM = 0.1; // SMS Niaga ~RM0.10/SMS
const GP = 0.72; // gross-profit rate for incremental-margin read

export type ArmDef = {
  key: string; // e.g. 'free_tea'
  label: string; // e.g. 'Free Tea'
  voucher_template_id: string; // voucher_templates.id to issue
  message: string; // SMS body (may contain {name})
};

type SegmentRow = {
  member_id: string; phone: string; name: string | null;
  // Reminder loops (noIssue) carry the member's EXISTING voucher so the
  // round attributes redemption of THAT reward instead of minting a new one.
  existing_reward_id?: string | null;
  reward_label?: string | null;
};

function rid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// "today" / "tomorrow" / "in N days" for SMS expiry urgency (null → "soon").
function expiryPhrase(iso: string | null | undefined): string {
  if (!iso) return "soon";
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  return `in ${d} days`;
}

// Segment inputs — each loop reads the few it needs (see LOOPS below).
export type SegmentOpts = {
  minDaysLapsed?: number; maxDaysLapsed?: number;   // winback
  joinedWithinDays?: number;                        // welcome
  birthdayWithinDays?: number;                      // birthday
  outletId?: string; activeWithinDays?: number;     // round_gap
  expiringWithinDays?: number;                      // reward_expiring
  minBeans?: number; idleMinDays?: number; idleMaxDays?: number; // beans_idle
};

type MemberRow = { id: string; phone: string | null; name: string | null; sms_opt_out: boolean | null; birthday: string | null; preferred_outlet_id: string | null };
const MEMBER_SELECT = "member_id, members!inner(id, phone, name, sms_opt_out, birthday, preferred_outlet_id)";

// Dedupe by phone, drop unreachable + PDPA opt-outs, apply an optional predicate.
function reachable(rows: Array<{ member_id: string; members: MemberRow | null }>, pred?: (m: MemberRow) => boolean): SegmentRow[] {
  const out: SegmentRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const m = r.members;
    if (!m) continue;
    if (m.sms_opt_out === true) continue;          // PDPA: never message opt-outs
    const phone = (m.phone ?? "").trim();
    if (!phone || seen.has(phone)) continue;
    if (pred && !pred(m)) continue;
    seen.add(phone);
    out.push({ member_id: r.member_id, phone, name: m.name ?? null });
  }
  return out;
}

// ── Reactivation: lapsed members (last visit between min..max days ago).
async function winbackSegment(o: SegmentOpts): Promise<{ rows: SegmentRow[]; label: string }> {
  const minD = o.minDaysLapsed ?? 30, maxD = o.maxDaysLapsed ?? 60;
  const sinceMax = new Date(Date.now() - maxD * 86400000).toISOString();
  const sinceMin = new Date(Date.now() - minD * 86400000).toISOString();
  const rows: Array<{ member_id: string; members: MemberRow | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("member_brands").select(MEMBER_SELECT)
      .eq("brand_id", BRAND).gte("last_visit_at", sinceMax).lt("last_visit_at", sinceMin).range(from, from + 999);
    if (error) throw new Error(`winback segment: ${error.message}`);
    const batch = (data ?? []) as unknown as Array<{ member_id: string; members: MemberRow | null }>;
    rows.push(...batch);
    if (batch.length < 1000) break; // page past Supabase's 1000-row cap so wide windows aren't truncated
  }
  return { rows: reachable(rows), label: `Lapsed ${minD}–${maxD}d` };
}

// ── Beans idle (REMINDER, noIssue): members sitting on >= minBeans loyalty
// points who've just gone quiet (idle idleMin..idleMax days). A gentle "you've
// got value waiting" nudge at the ~5-day mark — earlier + lighter than win-back
// (30-60d) and mints nothing (the beans already exist). {beans} is filled
// per-recipient in sendRound. The narrow trigger window keeps it to the daily
// flow crossing the idle mark, not a backlog dump.
async function beansIdleSegment(o: SegmentOpts): Promise<{ rows: SegmentRow[]; label: string }> {
  const minBeans = o.minBeans ?? 100;
  const idleMin = o.idleMinDays ?? 5, idleMax = o.idleMaxDays ?? 9;
  const sinceMax = new Date(Date.now() - idleMax * 86400000).toISOString();
  const sinceMin = new Date(Date.now() - idleMin * 86400000).toISOString();
  const rows: Array<{ member_id: string; members: MemberRow | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("member_brands").select(MEMBER_SELECT)
      .eq("brand_id", BRAND).gte("points_balance", minBeans)
      .gte("last_visit_at", sinceMax).lt("last_visit_at", sinceMin).range(from, from + 999);
    if (error) throw new Error(`beans_idle segment: ${error.message}`);
    const batch = (data ?? []) as unknown as Array<{ member_id: string; members: MemberRow | null }>;
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return { rows: reachable(rows), label: `${minBeans}+ Beans · idle ${idleMin}-${idleMax}d` };
}

// ── Welcome: members with a single visit, joined within N days (1st → 2nd).
async function welcomeSegment(o: SegmentOpts): Promise<{ rows: SegmentRow[]; label: string }> {
  const days = o.joinedWithinDays ?? 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows: Array<{ member_id: string; members: MemberRow | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("member_brands").select(MEMBER_SELECT)
      .eq("brand_id", BRAND).eq("total_visits", 1).gte("joined_at", since).range(from, from + 999);
    if (error) throw new Error(`welcome segment: ${error.message}`);
    const batch = (data ?? []) as unknown as Array<{ member_id: string; members: MemberRow | null }>;
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return { rows: reachable(rows), label: `New members · 1 visit, joined ≤${days}d` };
}

// ── Birthday: members whose birthday falls within the next K days.
// Filtered server-side via the loyalty_birthday_members RPC — member_brands has
// 20k+ rows, so the old "fetch all + filter in JS" silently hit the 1000-row
// default cap and missed qualifiers. The RPC matches by MM-DD in MYT.
async function birthdaySegment(o: SegmentOpts): Promise<{ rows: SegmentRow[]; label: string }> {
  const k = o.birthdayWithinDays ?? 0;
  const { data, error } = await supabaseAdmin.rpc("loyalty_birthday_members", { p_brand: BRAND, p_within_days: k });
  if (error) throw new Error(`birthday segment: ${error.message}`);
  const seen = new Set<string>();
  const rows: SegmentRow[] = [];
  for (const r of (data ?? []) as Array<{ member_id: string; phone: string; member_name: string | null }>) {
    const phone = (r.phone ?? "").trim();
    if (!phone || seen.has(phone)) continue; // dedupe by phone (PDPA opt-outs already excluded in the RPC)
    seen.add(phone);
    rows.push({ member_id: r.member_id, phone, name: r.member_name ?? null });
  }
  return { rows, label: k === 0 ? "Birthdays today" : `Birthdays in next ${k}d` };
}

// ── Weekly round-gap: active customers of one outlet (nudge to a weak round).
async function roundGapSegment(o: SegmentOpts): Promise<{ rows: SegmentRow[]; label: string }> {
  if (!o.outletId) throw new Error("round_gap needs an outletId");
  const days = o.activeWithinDays ?? 45;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const raw: Array<{ member_id: string; members: MemberRow | null }> = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from("member_brands").select(MEMBER_SELECT)
      .eq("brand_id", BRAND).gte("last_visit_at", since).range(from, from + 999);
    if (error) throw new Error(`round_gap segment: ${error.message}`);
    const batch = (data ?? []) as unknown as Array<{ member_id: string; members: MemberRow | null }>;
    raw.push(...batch);
    if (batch.length < 1000) break;
  }
  const rows = reachable(raw, (m) => m.preferred_outlet_id === o.outletId);
  return { rows, label: `Outlet actives ≤${days}d` };
}

// ── Reward-expiring (REMINDER, noIssue): members holding an active wallet
// voucher about to expire. We don't mint anything — the lure already exists;
// the SMS just pulls them back to redeem it before it's gone. One row per
// member (their SOONEST-expiring voucher), carrying that voucher's id + title
// so prepareRound attributes redemption of THAT reward and sendRound fills the
// {reward}/{expiry} tokens. Scoped to organically-won wallet sources — campaign
// (win-back/round-gap) vouchers are owned by their own loops, so excluded here
// to avoid double-messaging + double-counting.
const REMINDER_SOURCES = ["mystery", "mission", "birthday", "manual", "points_redemption"];
const DRINK_CATEGORIES = new Set(["classic", "flavoured", "mocha", "artisan-choc", "artisan-matcha", "fruit-tea", "gourmet-tea", "mocktails"]);
const REMINDER_MIN_GATE_SEN = 3000; // RM30 — discounts must lift the basket above AOV to be worth a reminder

type IrRow = {
  id: string; member_id: string; title: string | null; expires_at: string | null;
  discount_type: string | null; applicable_categories: string[] | null; min_order_value: number | null;
};

// Decide whether an expiring voucher is worth an SMS. Reminding costs money +
// realises the reward's COGS, so only the on-strategy ones qualify:
//   • a FREE DRINK (low COGS, visit-driving) — scoped entirely to drink
//     categories; free food/pastry (croissant/cake, RM6.50-9.60 COGS) is skipped
//     as claim-and-leave bait.
//   • a DISCOUNT gated at >= RM30 — it lifts the basket above AOV. Sub-RM30
//     discounts (e.g. the retired "RM3 off RM15+") pull below-median orders and
//     are skipped.
// Everything else (beans multiplier, ungated/loose discounts) is not reminded.
function worthReminding(ir: IrRow): boolean {
  if (ir.discount_type === "free_item") {
    const cats = ir.applicable_categories ?? [];
    return cats.length > 0 && cats.every((c) => DRINK_CATEGORIES.has(c));
  }
  if (["percent", "percentage", "flat", "fixed_amount", "combo", "override_price"].includes(ir.discount_type ?? "")) {
    return (ir.min_order_value ?? 0) >= REMINDER_MIN_GATE_SEN;
  }
  return false;
}

async function rewardExpiringSegment(o: SegmentOpts): Promise<{ rows: SegmentRow[]; label: string }> {
  const days = o.expiringWithinDays ?? 7;
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + days * 86400000).toISOString();

  // Active vouchers entering the expiry window, soonest first.
  const irs: IrRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from("issued_rewards")
      .select("id, member_id, title, expires_at, discount_type, applicable_categories, min_order_value")
      .eq("brand_id", BRAND)
      .eq("status", "active")
      .in("source_type", REMINDER_SOURCES)
      .not("expires_at", "is", null)
      .gte("expires_at", nowIso)
      .lt("expires_at", untilIso)
      .order("expires_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`reward_expiring segment: ${error.message}`);
    const batch = (data ?? []) as IrRow[];
    irs.push(...batch);
    if (batch.length < 1000) break;
  }
  // Keep each member's soonest-expiring WORTH-REMINDING voucher (irs asc by
  // expiry) — skip free food/pastry + sub-RM30 discounts so we never burn an
  // SMS giving away a croissant or pulling a below-median order.
  const byMember = new Map<string, IrRow>();
  for (const ir of irs) if (worthReminding(ir) && !byMember.has(ir.member_id)) byMember.set(ir.member_id, ir);
  const memberIds = [...byMember.keys()];
  if (memberIds.length === 0) return { rows: [], label: `Vouchers expiring ≤${days}d` };

  // Resolve phone / opt-out for those members.
  const memberById = new Map<string, MemberRow>();
  for (let i = 0; i < memberIds.length; i += 1000) {
    const { data, error } = await supabaseAdmin
      .from("members")
      .select("id, phone, name, sms_opt_out, birthday, preferred_outlet_id")
      .in("id", memberIds.slice(i, i + 1000));
    if (error) throw new Error(`reward_expiring members: ${error.message}`);
    for (const m of (data ?? []) as MemberRow[]) memberById.set(m.id, m);
  }

  // Exclude non-stackable-tier members (Black Card / Staff): their flat tier
  // discount REPLACES any voucher at the till, so they can NEVER redeem the
  // reward we'd remind them about — reminding is wasted SMS + a guaranteed
  // non-redemption. (Same rule the POS applies; see evaluate-promotions.)
  const nonStackable = new Set<string>();
  const { data: nsTiers } = await supabaseAdmin.from("tiers").select("id").eq("brand_id", BRAND).eq("stackable", false);
  const nsTierIds = (nsTiers ?? []).map((t: { id: string }) => t.id);
  if (nsTierIds.length) {
    for (let i = 0; i < memberIds.length; i += 1000) {
      const { data } = await supabaseAdmin
        .from("member_brands")
        .select("member_id")
        .eq("brand_id", BRAND)
        .in("member_id", memberIds.slice(i, i + 1000))
        .in("current_tier_id", nsTierIds);
      for (const r of (data ?? []) as { member_id: string }[]) nonStackable.add(r.member_id);
    }
  }

  const seen = new Set<string>();
  const rows: SegmentRow[] = [];
  for (const [memberId, ir] of byMember) {
    const m = memberById.get(memberId);
    if (!m || m.sms_opt_out === true) continue;
    if (nonStackable.has(memberId)) continue; // tier wipes the voucher — can't redeem
    const phone = (m.phone ?? "").trim();
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    rows.push({
      member_id: memberId,
      phone,
      name: m.name ?? null,
      existing_reward_id: ir.id,
      reward_label: ir.title ?? "reward",
    });
  }
  return { rows, label: `Vouchers expiring ≤${days}d` };
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

// sourceType tags the voucher's origin on issued_rewards. Most loops use
// "campaign" (the generic win-back/round-gap bucket), but lifecycle loops pass
// their own (e.g. Birthday → "birthday") so the native wallet shows the right
// eyebrow + styling ("Birthday gift", gift icon) instead of a generic
// "Welcome back" campaign card. Attribution keys off source_ref_id (the round
// id), NOT source_type, so this is display-only and safe to vary per loop.
export async function issueReward(memberId: string, templateId: string, roundId: string, sourceType: string): Promise<{ id: string; cogsRm: number } | null> {
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
    source_type: sourceType,
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
export async function prepareRound(loopKey: LoopKey, opts: {
  arms: ArmDef[];
  holdoutPct?: number;
  attributionWindowDays?: number;
  createdBy?: string;
  suppressPhones?: string[]; // PDPA opt-outs / recent contacts
  maxRecipients?: number; // cap total segment size to fit an SMS budget (start small, scale later)
  segment?: SegmentOpts; // loop-specific audience controls
}) {
  const def = LOOPS[loopKey];
  if (!def) throw new Error(`unknown loop: ${loopKey}`);
  const holdoutPct = opts.holdoutPct ?? def.defaultHoldoutPct;
  const windowDays = opts.attributionWindowDays ?? def.defaultWindowDays;
  const arms = opts.arms;
  if (!arms.length) throw new Error("at least one arm required");

  const suppress = new Set((opts.suppressPhones ?? []).map((p) => p.trim()));
  const seg = await def.segment(opts.segment ?? {});
  let segment = seg.rows.filter((m) => !suppress.has(m.phone));
  segment = shuffle(segment);
  // Budget cap — take the first N of the shuffled (random) segment so the
  // SMS spend stays within the chosen budget. Scaling later = raise the cap.
  const rawReach = segment.length;
  const capped = !!(opts.maxRecipients && opts.maxRecipients > 0 && opts.maxRecipients < rawReach);
  if (capped) segment = segment.slice(0, opts.maxRecipients);

  // No one qualifies — don't create an empty round (keeps the daily trigger
  // cron from littering rounds on days with no birthdays/lapses/new members).
  if (segment.length === 0) {
    return {
      round_id: "", round_no: 0, segment_label: `${seg.label} (0 reachable)`,
      total: 0, holdout: 0, arm_counts: {}, est_sms_cost_rm: 0, est_reward_cogs_rm: 0,
      status: "prepared" as const,
    };
  }

  // next round number for this loop
  const { data: last } = await supabaseAdmin
    .from("loop_rounds")
    .select("round_no")
    .eq("loop_key", loopKey)
    .order("round_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const roundNo = (last?.round_no ?? 0) + 1;
  const roundId = rid("lr");

  // split: holdout first, then round-robin across arms
  const holdoutN = Math.round((segment.length * holdoutPct) / 100);
  const holdout = segment.slice(0, holdoutN);
  const treatment = segment.slice(holdoutN);

  const segmentLabel = `${seg.label} (${segment.length} reachable, ${holdoutPct}% holdout)${capped ? ` · budget-capped from ${rawReach}` : ""}`;

  await supabaseAdmin.from("loop_rounds").insert({
    id: roundId,
    brand_id: BRAND,
    loop_key: loopKey,
    round_no: roundNo,
    segment_label: segmentLabel,
    holdout_pct: holdoutPct,
    arms: arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message })),
    attribution_window_days: windowDays,
    status: "prepared",
    created_by: opts.createdBy ?? null,
  });

  // Voucher source bucket per loop — Birthday vouchers read as a birthday
  // gift in the wallet; every other loop stays in the generic "campaign"
  // bucket. Display-only (attribution joins on source_ref_id).
  const sourceType = loopKey === "birthday" ? "birthday" : "campaign";

  const armCounts: Record<string, number> = {};
  let rewardCogs = 0;

  // holdout assignments (no reward, no SMS). For reminder loops, still pin the
  // member's EXISTING expiring voucher so measureRound compares redemption of
  // the same reward across treatment vs holdout (fair lift, not 0 by omission).
  const holdoutRows = holdout.map((m) => ({
    id: rid("la"),
    round_id: roundId,
    member_id: m.member_id,
    phone: m.phone,
    arm: "holdout",
    ...(def.noIssue ? { issued_reward_id: m.existing_reward_id ?? null } : {}),
  }));
  if (holdoutRows.length) await supabaseAdmin.from("loop_assignments").insert(holdoutRows);
  armCounts["holdout"] = holdoutRows.length;

  // treatment: round-robin. Standard loops MINT the arm's voucher; reminder
  // loops (noIssue) attribute the member's existing voucher and mint nothing.
  for (let i = 0; i < treatment.length; i++) {
    const m = treatment[i];
    const arm = arms[i % arms.length];
    let issuedRewardId: string | null;
    if (def.noIssue) {
      issuedRewardId = m.existing_reward_id ?? null;
    } else {
      const issued = await issueReward(m.member_id, arm.voucher_template_id, roundId, sourceType);
      if (issued) rewardCogs += issued.cogsRm;
      issuedRewardId = issued?.id ?? null;
    }
    await supabaseAdmin.from("loop_assignments").insert({
      id: rid("la"),
      round_id: roundId,
      member_id: m.member_id,
      phone: m.phone,
      arm: arm.key,
      issued_reward_id: issuedRewardId,
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

  // Honor the app_settings SMS toggle (smsniaga) — sendSMS otherwise falls back
  // to the env default (sms123), which fails marketing blasts.
  const provider = await getActiveSmsProvider();

  const armMsg: Record<string, string> = {};
  for (const a of (round.arms as ArmDef[])) armMsg[a.key] = a.message;

  const { data: rows } = await supabaseAdmin
    .from("loop_assignments")
    .select("id, phone, arm, sms_status, member_id, issued_reward_id")
    .eq("round_id", roundId)
    .neq("arm", "holdout");

  // Per-recipient {name} personalisation: substitute the member's FIRST name
  // (short, to stay within one GSM-7 segment). Only fetch names if any arm copy
  // actually uses {name}, so loops without it pay nothing.
  const needsName = Object.values(armMsg).some((m) => m.includes("{name}"));
  const firstNameById = new Map<string, string>();
  if (needsName) {
    const ids = [...new Set(((rows ?? []) as Array<{ member_id: string | null }>).map((r) => r.member_id).filter(Boolean))] as string[];
    for (let i = 0; i < ids.length; i += 1000) {
      const { data: ms } = await supabaseAdmin.from("members").select("id, name").in("id", ids.slice(i, i + 1000));
      for (const m of (ms ?? []) as Array<{ id: string; name: string | null }>) {
        const first = (m.name ?? "").trim().split(/\s+/)[0];
        if (first) firstNameById.set(m.id, first);
      }
    }
  }

  // Per-recipient {reward}/{expiry} personalisation for reminder loops: resolve
  // the assignment's attributed voucher (title + expiry) so each SMS names the
  // member's own reward. Same pay-nothing-unless-used guard as {name}.
  const needsReward = Object.values(armMsg).some((m) => m.includes("{reward}") || m.includes("{expiry}"));
  const rewardByIrId = new Map<string, { title: string | null; expires_at: string | null }>();
  if (needsReward) {
    const irIds = [...new Set(((rows ?? []) as Array<{ issued_reward_id: string | null }>).map((r) => r.issued_reward_id).filter(Boolean))] as string[];
    for (let i = 0; i < irIds.length; i += 1000) {
      const { data: irs } = await supabaseAdmin.from("issued_rewards").select("id, title, expires_at").in("id", irIds.slice(i, i + 1000));
      for (const ir of (irs ?? []) as Array<{ id: string; title: string | null; expires_at: string | null }>) {
        rewardByIrId.set(ir.id, { title: ir.title, expires_at: ir.expires_at });
      }
    }
  }

  // Per-recipient {beans} = the member's live points balance; {redeem} = the
  // priciest points-shop reward that balance can afford right now ("you have N
  // points, enough for <best reward>"). Both need the member's balance.
  const needsBeans = Object.values(armMsg).some((m) => m.includes("{beans}"));
  const needsRedeem = Object.values(armMsg).some((m) => m.includes("{redeem}"));
  const beansById = new Map<string, number>();
  if (needsBeans || needsRedeem) {
    const ids = [...new Set(((rows ?? []) as Array<{ member_id: string | null }>).map((r) => r.member_id).filter(Boolean))] as string[];
    for (let i = 0; i < ids.length; i += 1000) {
      const { data: bs } = await supabaseAdmin.from("member_brands").select("member_id, points_balance").eq("brand_id", BRAND).in("member_id", ids.slice(i, i + 1000));
      for (const b of (bs ?? []) as Array<{ member_id: string; points_balance: number | null }>) {
        beansById.set(b.member_id, Math.max(0, Math.floor(b.points_balance ?? 0)));
      }
    }
  }
  // Points-shop catalogue (active templates with a points_cost), priciest first,
  // so the first one a balance clears is the highest redemption they can do.
  const redeemTiers: Array<{ cost: number; title: string }> = [];
  if (needsRedeem) {
    const { data: cat } = await supabaseAdmin.from("voucher_templates")
      .select("title, points_cost").eq("brand_id", BRAND).eq("is_active", true)
      .gt("points_cost", 0).order("points_cost", { ascending: false });
    for (const c of (cat ?? []) as Array<{ title: string | null; points_cost: number | null }>) {
      if (c.title && c.points_cost != null) redeemTiers.push({ cost: c.points_cost, title: c.title.trim() });
    }
  }
  const topRedeemFor = (balance: number): string => (redeemTiers.find((t) => t.cost <= balance)?.title ?? "a reward");

  // Push-preferred delivery: a member with a registered device gets a FREE push;
  // everyone else falls back to (paid) SMS. Same holdout + attribution either
  // way — only the channel differs. Resolve all treatment members' tokens up
  // front in one query.
  const treatmentMemberIds = ((rows ?? []) as Array<{ member_id: string | null }>)
    .map((r) => r.member_id).filter((x): x is string => !!x);
  const tokensByMember = await pushTokensByMember(treatmentMemberIds);

  // GLOBAL frequency cap across ALL marketing sends: skip any member who
  // already hit the weekly cap so winback + round-gap + reward-expiring etc.
  // can't stack into spam in one week. Per-loop cooldowns don't see each
  // other; this does — and since migration 068 the RPC also counts
  // campaigns-auto / manual-blast sends (sms_logs), which previously slipped
  // past the cap. Tunable: app_settings.marketing_weekly_cap (default 2/7d).
  const cappedPhones = new Set<string>();
  {
    let cap = 2;
    try {
      const { data: s } = await supabaseAdmin.from("app_settings").select("value").eq("key", "marketing_weekly_cap").maybeSingle();
      const n = parseInt(String(s?.value ?? "").replace(/[^0-9]/g, ""), 10);
      if (Number.isFinite(n) && n > 0) cap = n;
    } catch { /* default 2 */ }
    const { data: cp } = await supabaseAdmin.rpc("loyalty_capped_phones", { p_cap: cap, p_days: 7 });
    for (const r of (cp ?? []) as Array<{ phone: string }>) if (r.phone) cappedPhones.add(r.phone.trim());
  }

  let sentPush = 0;
  let sentSms = 0;
  let failed = 0;
  let capped = 0;
  let firstError: string | undefined;
  for (const r of (rows ?? []) as Array<{ id: string; phone: string; arm: string; sms_status: string | null; member_id: string | null; issued_reward_id: string | null }>) {
    if (r.sms_status === "sent") continue; // idempotent (covers push + SMS)
    if (cappedPhones.has(r.phone)) { // global weekly cap hit on another loop
      await supabaseAdmin.from("loop_assignments").update({ sms_status: "capped", sms_message_id: "weekly_cap" }).eq("id", r.id);
      capped++; continue;
    }
    let message = armMsg[r.arm] ?? "";
    if (!message) { failed++; continue; }
    if (needsName) {
      const first = (r.member_id && firstNameById.get(r.member_id)) || "there";
      message = message.replace(/\{name\}/g, first);
    }
    if (needsReward) {
      const rw = r.issued_reward_id ? rewardByIrId.get(r.issued_reward_id) : undefined;
      message = message
        .replace(/\{reward\}/g, (rw?.title ?? "reward").trim())
        .replace(/\{expiry\}/g, expiryPhrase(rw?.expires_at));
    }
    if (needsBeans || needsRedeem) {
      const beans = (r.member_id && beansById.get(r.member_id)) || 0;
      message = message.replace(/\{beans\}/g, String(beans)).replace(/\{redeem\}/g, topRedeemFor(beans));
    }

    const tokens = r.member_id ? tokensByMember.get(r.member_id) : undefined;
    if (tokens && tokens.length) {
      const pr = await sendPushToTokens(tokens, message);
      await supabaseAdmin.from("loop_assignments")
        .update({ channel: "push", sms_status: pr.ok ? "sent" : "failed", sms_message_id: pr.ok ? "push" : `push:${(pr.error ?? "failed").slice(0, 180)}` })
        .eq("id", r.id);
      if (pr.ok) { sentPush++; } else { failed++; if (!firstError) firstError = `push: ${pr.error}`; }
    } else {
      // On failure, stash the error in sms_message_id so it's queryable.
      const res = await sendSMS(r.phone, message, { provider });
      await supabaseAdmin.from("loop_assignments")
        .update({ channel: "sms", sms_status: res.success ? "sent" : "failed", sms_message_id: res.success ? (res.messageId ?? null) : (res.error?.slice(0, 200) ?? "failed") })
        .eq("id", r.id);
      if (res.success) { sentSms++; } else { failed++; if (!firstError) firstError = res.error; }
    }
  }

  const sentAt = new Date();
  await supabaseAdmin
    .from("loop_rounds")
    // Stamp the window it actually went out in (kept if pre-scheduled) so the
    // send-time leaderboard can attribute conversion to a time of day.
    .update({ status: "sent", sent_at: sentAt.toISOString(), send_window: round.send_window ?? deriveWindow(sentAt) })
    .eq("id", roundId);

  return { round_id: roundId, sent: sentPush + sentSms, sent_push: sentPush, sent_sms: sentSms, capped, failed, error: firstError };
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
    .select("id, phone, arm, issued_reward_id, assigned_at, sms_status")
    .eq("round_id", roundId);

  const windowMs = (round.attribution_window_days as number) * 86400000;

  // Round-gap rounds measure round-specifically: only orders placed AT THE TARGET
  // OUTLET during the TARGET ROUND (day-part) count as conversions — that's the
  // behaviour the campaign moves, so lift vs holdout isn't diluted by "any order".
  const RG_OUTLET_IDS: Record<string, string[]> = {
    conezion: ["conezion", "outlet-con"],
    "shah-alam": ["shah-alam", "outlet-sa"],
    tamarind: ["tamarind", "outlet-tam"],
  };
  const meta = (round.meta ?? {}) as {
    kind?: string; outlet?: string; round_start?: number; round_end?: number;
    promo_id?: string; member_tag?: string; // legacy single-promo rounds
    promos?: Array<{ promo_id?: string; tag?: string }>; // per-arm offers (v5+)
  };
  const rgMeta =
    meta.kind === "round_gap" && meta.outlet != null && meta.round_start != null && meta.round_end != null
      ? { round_start: meta.round_start, round_end: meta.round_end, outletIds: RG_OUTLET_IDS[meta.outlet] ?? [meta.outlet] }
      : null;
  const mytHour = (iso: string) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" })).getHours();

  // HONEST CONTROL: a holdout only measures "no message" if they truly received
  // none. Sibling loops share the audience, so a holdout here can be TREATED by
  // another loop inside this round's window (measured at ~17% for winback) —
  // that biases the baseline up and understates lift. Exclude them from stats.
  // GRANT rounds skip this: their 'holdout' is a control that RECEIVED the
  // status-quo reward (not "no message"), and sibling-loop SMS lands on
  // control and treatment symmetrically (randomised at grant time) — so
  // excluding only contaminated controls would bias the baseline down.
  const isGrantRound = (round.meta as { kind?: string } | null)?.kind === "grant";
  const holdoutPhones = ((rows ?? []) as Array<{ arm: string; phone: string }>)
    .filter((r) => r.arm === "holdout").map((r) => r.phone);
  const contaminated = new Set<string>();
  if (holdoutPhones.length && round.sent_at && !isGrantRound) {
    const winStart = round.sent_at as string;
    const winEnd = new Date(new Date(winStart).getTime() + windowMs).toISOString();
    for (let i = 0; i < holdoutPhones.length; i += 200) {
      const { data: hits } = await supabaseAdmin
        .from("loop_assignments")
        .select("phone, loop_rounds!inner(sent_at)")
        .in("phone", holdoutPhones.slice(i, i + 200))
        .eq("sms_status", "sent")
        .neq("round_id", roundId)
        .gte("loop_rounds.sent_at", winStart)
        .lte("loop_rounds.sent_at", winEnd);
      for (const h of (hits ?? []) as Array<{ phone: string }>) contaminated.add(h.phone);
    }
  }
  let holdoutExcluded = 0;
  const unsentByArm: Record<string, number> = {};

  type Acc = { n: number; converted: number; redeemed: number; revenueRm: number };
  const byArm: Record<string, Acc> = {};

  for (const r of (rows ?? []) as Array<{ id: string; phone: string; arm: string; issued_reward_id: string | null; assigned_at: string; sms_status: string | null }>) {
    if (r.arm === "holdout" && contaminated.has(r.phone)) { holdoutExcluded++; continue; }
    // SYMMETRIC HONESTY for sending loops: a treatment member whose message
    // never went out (weekly-capped, gateway-failed, or round interrupted
    // pre-send) was never actually treated — counting them dilutes the arm
    // toward the holdout and understates lift, worst when sibling loops have
    // consumed the weekly cap first. Grant rounds keep every row: nothing is
    // sent, so there is no delivery to condition on.
    if (r.arm !== "holdout" && !isGrantRound && r.sms_status !== "sent") {
      unsentByArm[r.arm] = (unsentByArm[r.arm] ?? 0) + 1;
      continue;
    }
    const acc = (byArm[r.arm] ??= { n: 0, converted: 0, redeemed: 0, revenueRm: 0 });
    acc.n++;

    const start = new Date(r.assigned_at).toISOString();
    const end = new Date(new Date(r.assigned_at).getTime() + windowMs).toISOString();

    // orders by phone in the window (online + POS)
    const [{ data: o1 }, { data: o2 }] = await Promise.all([
      supabaseAdmin.from("orders").select("total, created_at, store_id").eq("customer_phone", r.phone).gte("created_at", start).lte("created_at", end),
      supabaseAdmin.from("pos_orders").select("total, created_at, outlet_id").eq("customer_phone", r.phone).gte("created_at", start).lte("created_at", end),
    ]);
    let orders = [
      ...((o1 ?? []) as Array<{ total: number | null; created_at: string; store_id: string | null }>).map((o) => ({ total: o.total, created_at: o.created_at, outlet: o.store_id })),
      ...((o2 ?? []) as Array<{ total: number | null; created_at: string; outlet_id: string | null }>).map((o) => ({ total: o.total, created_at: o.created_at, outlet: o.outlet_id })),
    ];
    if (rgMeta) {
      orders = orders.filter((o) => {
        if (!o.outlet || !rgMeta.outletIds.includes(o.outlet)) return false;
        const h = mytHour(o.created_at);
        return h >= rgMeta.round_start && h < rgMeta.round_end;
      });
    }
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
    return {
      arm, n: a.n, conversion_rate: +(convRate * 100).toFixed(1), redemption_rate: +(redeemRate * 100).toFixed(1), lift_pp: liftPp, revenue_rm: +a.revenueRm.toFixed(2), revenue_per_recipient_rm: marginPerRecipientRm,
      // Audit trail: how many holdouts were dropped as contaminated (treated by
      // a sibling loop inside this window). Only ever set on the holdout row.
      ...(arm === "holdout" && holdoutExcluded > 0 ? { excluded_contaminated: holdoutExcluded } : {}),
      // Audit trail: treatment rows dropped because their message never went
      // out (capped/failed) — they were never treated, so they don't dilute.
      ...(arm !== "holdout" && (unsentByArm[arm] ?? 0) > 0 ? { excluded_unsent: unsentByArm[arm] } : {}),
    };
  });

  await supabaseAdmin
    .from("loop_rounds")
    .update({ status: "measured", measured_at: new Date().toISOString(), stats })
    .eq("id", roundId);

  // Round-gap: once measured, retire every auto-created promo + strip its tag so
  // no offer lingers past its window. v5 rounds carry one promo per arm
  // (meta.promos); legacy rounds carried a single (meta.promo_id, meta.member_tag).
  if (rgMeta) {
    const toClean = meta.promos?.length
      ? meta.promos.map((p) => ({ promo_id: p.promo_id, tag: p.tag }))
      : meta.promo_id
        ? [{ promo_id: meta.promo_id, tag: meta.member_tag }]
        : [];
    for (const c of toClean) {
      await supabaseAdmin.rpc("loyalty_round_gap_cleanup", { p_promo_id: c.promo_id ?? null, p_tag: c.tag ?? null });
    }
  }

  return { round_id: roundId, holdout_conversion_rate: +(holdoutRate * 100).toFixed(1), stats };
}

// ============================================================================
// ADAPTIVE OPTIMIZER — the loop "learns" instead of running a fixed template.
//
// Offer SPACE (not 3 frozen arms): a grid across logic × value × threshold.
// Each round = the current CHAMPION (best cumulative incremental margin with
// enough evidence) + CHALLENGERS (least-tested / new logics) so the engine
// keeps exploring. A persistent leaderboard over all measured rounds is what
// makes it better over time. proposeArms() returns the next round's arm set;
// the operator approves before any SMS goes out.
// ============================================================================

export type OfferCandidate = {
  key: string;
  label: string;
  logic: "% discount" | "flat discount" | "BOGO" | "free item";
  voucher_template_id: string;
  /** The deal phrase, objective-NEUTRAL — slotted into each loop's
   *  messageTemplate (see LOOPS) so the same offer reads right in a
   *  Welcome vs Birthday vs Win-back SMS. e.g. "15% off when you spend RM40+". */
  offer: string;
};

// The explorable offer space. Extend freely — every new voucher_template added
// here becomes a candidate the optimizer can test. Round-robin diversity +
// least-tested-first selection means new entries get explored automatically.
// `offer` is the deal only; the per-loop template supplies the framing.
export const OFFER_CANDIDATES: OfferCandidate[] = [
  { key: "pct10_min25", label: "10% off RM25+", logic: "% discount", voucher_template_id: "a0000010-0000-4000-8000-000000000010", offer: "10% off when you spend RM25+" },
  { key: "pct15_min40", label: "15% off RM40+", logic: "% discount", voucher_template_id: "eb47fd73-42ab-4eb6-ade4-a12f96912d00", offer: "15% off when you spend RM40+" },
  { key: "pct20_min40", label: "20% off RM40+", logic: "% discount", voucher_template_id: "a0000020-0000-4000-8000-000000000020", offer: "20% off when you spend RM40+ (capped at RM12)" },
  { key: "flat5_min25", label: "RM5 off RM25+", logic: "flat discount", voucher_template_id: "a0000005-0000-4000-8000-000000000005", offer: "RM5 off when you spend RM25+" },
  { key: "flat10_min30", label: "RM10 off RM30+", logic: "flat discount", voucher_template_id: "02ca62f1-171d-41d2-b6d6-9ca2d67ca3b9", offer: "RM10 off when you spend RM30+" },
  { key: "flat15_min50", label: "RM15 off RM50+", logic: "flat discount", voucher_template_id: "3c0288b5-51db-4e82-a583-6ed1dbc351b5", offer: "RM15 off when you spend RM50+" },
  { key: "b1f1_drinks", label: "Buy 1 Free 1 drinks", logic: "BOGO", voucher_template_id: "ed33eb26-4ead-414d-b1ee-179999a33940", offer: "buy 1 free 1 on any drink" },
  // Free-item crowd-pullers — NOT tea (Celsius isn't a tea brand). Free Coffee
  // covers classics; Free Drink covers any drink category.
  { key: "free_coffee", label: "Free Coffee", logic: "free item", voucher_template_id: "206b5fbf-c12a-44e5-ad30-85a9e8a81439", offer: "a free coffee, on us" },
  { key: "free_drink", label: "Free Drink", logic: "free item", voucher_template_id: "9cb1a485-4e68-46a9-a8f1-0dec4519c641", offer: "a free drink, on us" },
];

// ── Loop registry: each campaign objective is a loop. Same machinery
// (holdout → optimise offers → auto-issue voucher → measure lift), different
// audience + candidate subset. Add a loop here and it inherits the whole engine.
export type LoopKey = "winback" | "welcome" | "birthday" | "round_gap" | "reward_expiring" | "beans_idle" | "mission_reward";
export type LoopDef = {
  key: LoopKey;
  label: string;
  objective: string;
  defaultHoldoutPct: number;
  defaultWindowDays: number;
  candidateKeys: string[]; // which OFFER_CANDIDATES this loop explores
  /** Objective-specific SMS copy. "{offer}" is replaced with the arm's
   *  offer phrase so each campaign reads right (a Welcome ≠ a Win-back).
   *  Keep it GSM-7 (no emoji) + short — the gateway prepends ~20 chars. */
  messageTemplate: string;
  /** When set, this loop fires AUTOMATICALLY: a daily cron issues + sends to
   *  each newly-qualifying member (no budget cap, no manual approval). The
   *  segmentOpts narrow the segment to TODAY's new qualifiers; cooldownDays
   *  prevents re-targeting the same member for the same event. Undefined =
   *  batch/manual (operator prepares + budgets + schedules a round). */
  trigger?: { holdoutPct: number; cooldownDays: number; segmentOpts: SegmentOpts };
  /** REMINDER loop: the lure already exists in the member's wallet, so the
   *  round does NOT mint a voucher. prepareRound attributes the member's
   *  existing expiring voucher (carried on the segment row) instead. Arms are
   *  message-only; candidateKeys is empty (no offer to optimise). */
  noIssue?: boolean;
  /** GRANT loop: assignments happen in the ORDER app at the moment a reward
   *  is handed out (see @celsius/shared grant-loop) — nothing is sent, and
   *  the 'holdout' arm is a CONTROL that receives the status-quo reward, not
   *  nothing. Rounds roll: status 'open' accumulates assignments, then closes
   *  to 'sent' (here or in the order app) and measures like any other round.
   *  prepareRound/sendRound never run for these; the segment is a stub. */
  grant?: boolean;
  segment: (o: SegmentOpts) => Promise<{ rows: SegmentRow[]; label: string }>;
};

export const LOOPS: Record<LoopKey, LoopDef> = {
  // Triggered (auto): reactivation fires when a member crosses ~30d inactive;
  // welcome ~1 day after the 1st visit; birthday on the day. round_gap stays
  // batch/manual (an operator-driven, budget-capped weekly push).
  winback:   { key: "winback",   label: "Reactivation",      objective: "Win back lapsed customers",        defaultHoldoutPct: 20, defaultWindowDays: 7,  candidateKeys: ["pct10_min25", "pct15_min40", "pct20_min40", "flat5_min25", "flat10_min30", "flat15_min50", "b1f1_drinks"], messageTemplate: "We miss you at Celsius! Come back and enjoy {offer} - just show your number at any outlet to redeem.", trigger: { holdoutPct: 10, cooldownDays: 30, segmentOpts: { minDaysLapsed: 30, maxDaysLapsed: 60 } }, segment: winbackSegment },
  welcome:   { key: "welcome",   label: "Welcome",           objective: "Turn the 1st visit into a 2nd",    defaultHoldoutPct: 20, defaultWindowDays: 14, candidateKeys: ["pct10_min25", "flat5_min25", "b1f1_drinks", "free_drink"], messageTemplate: "Welcome to Celsius! Enjoy {offer} on your next visit - just show your number at any outlet to redeem.", trigger: { holdoutPct: 10, cooldownDays: 365, segmentOpts: { joinedWithinDays: 10 } }, segment: welcomeSegment },
  birthday:  { key: "birthday",  label: "Birthday",          objective: "Bring members in on their birthday", defaultHoldoutPct: 0,  defaultWindowDays: 14, candidateKeys: ["free_coffee", "free_drink"], messageTemplate: "Happy birthday from Celsius! Enjoy {offer} - just show your number at any outlet to redeem.", trigger: { holdoutPct: 0, cooldownDays: 300, segmentOpts: { birthdayWithinDays: 0 } }, segment: birthdaySegment },
  round_gap: { key: "round_gap", label: "Weekly round-gap",  objective: "Fill an underperforming day-part",  defaultHoldoutPct: 20, defaultWindowDays: 7,  candidateKeys: ["pct15_min40", "flat10_min30", "b1f1_drinks"], messageTemplate: "Celsius misses you! Enjoy {offer} this week - just show your number at any outlet to redeem.", segment: roundGapSegment },
  // Reminder loop (manual/operator-gated — no trigger): pull members back to
  // redeem a voucher they ALREADY won before it expires. noIssue → attributes
  // the existing voucher; {reward}/{expiry} filled per-recipient in sendRound.
  // Auto-triggered daily (no budget cap, no manual approval): each day, members
  // whose unused voucher just entered the ≤3-day urgency window get one SMS
  // naming their own reward. 10% holdout keeps measuring whether the reminder
  // lifts redemption/orders vs not-reminding (ROI shows in the campaign
  // scorecard); 30-day cooldown stops re-messaging the same member.
  reward_expiring: { key: "reward_expiring", label: "Reward expiring", objective: "Redeem an unused voucher before it expires", defaultHoldoutPct: 20, defaultWindowDays: 7, candidateKeys: [], noIssue: true, messageTemplate: "Your {reward} at Celsius expires {expiry}! Show your number at any outlet to redeem before it's gone.", trigger: { holdoutPct: 10, cooldownDays: 30, segmentOpts: { expiringWithinDays: 3 } }, segment: rewardExpiringSegment },
  // Reminder loop (noIssue, auto-triggered daily): nudge members sitting on
  // idle Points the moment they go quiet (~5d). Mints nothing — the value
  // already exists. Push-first (free) + SMS fallback, 10% holdout measures lift.
  beans_idle: { key: "beans_idle", label: "Points sitting unused", objective: "Bring back members with idle Points", defaultHoldoutPct: 20, defaultWindowDays: 7, candidateKeys: [], noIssue: true, messageTemplate: "Hi {name}! You have {beans} points at Celsius - enough for {redeem}. Redeem this week before they slip away. Show your number.", trigger: { holdoutPct: 10, cooldownDays: 30, segmentOpts: { minBeans: 100, idleMinDays: 5, idleMaxDays: 9 } }, segment: beansIdleSegment },
  // Grant loop (no SMS): which mission-completion reward best drives the next
  // visit. Assignments are made by the order app as missions complete
  // (@celsius/shared MISSION_REWARD_LOOP); control = the mission's own reward.
  mission_reward: { key: "mission_reward", label: "Mission reward", objective: "Find the completion reward that best drives the next visit", defaultHoldoutPct: 50, defaultWindowDays: 14, candidateKeys: [], grant: true, messageTemplate: "", segment: async () => ({ rows: [], label: "Mission completers (grant-time)" }) },
};

// Curated SMS per (loop × offer): slot the offer phrase into the loop's
// objective copy so Welcome/Birthday/round-gap read right — not win-back copy.
export function composeMessage(loopKey: LoopKey, c: OfferCandidate): string {
  return LOOPS[loopKey].messageTemplate.replace("{offer}", c.offer);
}

function toArmDef(c: OfferCandidate, message: string): ArmDef {
  return { key: c.key, label: c.label, voucher_template_id: c.voucher_template_id, message };
}

type StoredArm = { key: string; label: string; voucher_template_id: string; message: string };
type StoredStat = {
  arm: string; n: number; lift_pp: number; revenue_per_recipient_rm: number;
  conversion_rate?: number; redemption_rate?: number; revenue_rm?: number;
};

// ── POOLED HOLDOUT BASELINE ──────────────────────────────────────────────────
// Per-round holdouts are tiny (10% of a 50-person round = ~5 people; small loops
// get 1-3), so per-round lift_pp is statistical noise — one random holdout order
// swings it ±30pp. The honest read pools EVERY measured round's holdout into one
// baseline per loop, then scores each arm's pooled conversion/revenue against
// it. (This is how the winback +3-4pp signal was validated: 110 pooled holdouts,
// not 3.) All aggregations below use this instead of averaging stored lift_pp.
function pooledHoldoutBaseline(statsList: Array<StoredStat[] | null | undefined>): { n: number; convRate: number; revPerRecipient: number } {
  let n = 0, converted = 0, revenue = 0;
  for (const stats of statsList) {
    const h = stats?.find((s) => s.arm === "holdout");
    if (!h || !h.n) continue;
    n += h.n;
    converted += h.n * (h.conversion_rate ?? 0) / 100;
    revenue += h.revenue_rm ?? (h.revenue_per_recipient_rm ?? 0) * h.n;
  }
  return { n, convRate: n ? (converted / n) * 100 : 0, revPerRecipient: n ? revenue / n : 0 };
}

export type LeaderboardEntry = {
  template_id: string;
  key: string | null;
  label: string;
  logic: string | null;
  rounds: number;
  recipients: number;
  avg_lift_pp: number;
  incr_margin_per_recipient_rm: number;
  cum_incr_margin_rm: number;
};

// Aggregate every MEASURED round into a per-offer leaderboard. Each offer's
// pooled conversion/revenue is scored against the loop's POOLED holdout
// baseline (pooledHoldoutBaseline) — never per-round holdouts, which are too
// small to mean anything — so a champion only emerges with real evidence.
export async function getLeaderboard(loopKey: LoopKey = "winback"): Promise<LeaderboardEntry[]> {
  const { data: rounds } = await supabaseAdmin
    .from("loop_rounds")
    .select("arms, stats, holdout_pct")
    .eq("loop_key", loopKey)
    .eq("status", "measured");

  // Pool the loop's holdouts into ONE baseline, then pool each offer's raw
  // counts and score against it — never average per-round lift_pp (noise).
  const roundList = (rounds ?? []) as Array<{ arms: StoredArm[] | null; stats: StoredStat[] | null }>;
  const base = pooledHoldoutBaseline(roundList.map((r) => r.stats));

  type Agg = { label: string; key: string | null; logic: string | null; n: number; converted: number; revenue: number; rounds: number };
  const agg = new Map<string, Agg>();

  for (const r of roundList) {
    const stats = r.stats; const arms = r.arms;
    if (!stats || !arms) continue;
    for (const s of stats) {
      if (s.arm === "holdout") continue;
      const arm = arms.find((a) => a.key === s.arm);
      if (!arm) continue;
      const tid = arm.voucher_template_id;
      const cand = OFFER_CANDIDATES.find((c) => c.voucher_template_id === tid);
      const e = agg.get(tid) ?? { label: cand?.label ?? arm.label, key: cand?.key ?? null, logic: cand?.logic ?? null, n: 0, converted: 0, revenue: 0, rounds: 0 };
      e.n += s.n;
      e.converted += s.n * (s.conversion_rate ?? 0) / 100;
      e.revenue += s.revenue_rm ?? (s.revenue_per_recipient_rm ?? 0) * s.n;
      e.rounds += 1;
      agg.set(tid, e);
    }
  }

  const out: LeaderboardEntry[] = [...agg.entries()].map(([tid, e]) => {
    const convRate = e.n ? (e.converted / e.n) * 100 : 0;
    const revPer = e.n ? e.revenue / e.n : 0;
    const incrMargin = (revPer - base.revPerRecipient) * e.n * GP;
    return {
      template_id: tid, key: e.key, label: e.label, logic: e.logic, rounds: e.rounds,
      recipients: e.n,
      avg_lift_pp: +(convRate - base.convRate).toFixed(1),
      incr_margin_per_recipient_rm: +(e.n ? incrMargin / e.n : 0).toFixed(2),
      cum_incr_margin_rm: +incrMargin.toFixed(2),
    };
  });
  out.sort((a, b) => b.incr_margin_per_recipient_rm - a.incr_margin_per_recipient_rm);
  return out;
}

export type ProposalArm = ArmDef & { role: "champion" | "challenger"; reason: string };
export type Proposal = { arms: ProposalArm[] };

// Minimum cumulative recipients before an offer can be crowned champion —
// guards against declaring a winner off noise from a tiny first round.
const CHAMPION_MIN_RECIPIENTS = 300;

// Pick the next round's arms: champion (best proven offer) + challengers
// (least-tested first, diverse logic) so the search never stalls.
export async function proposeArms(loopKey: LoopKey = "winback", opts?: { count?: number }): Promise<Proposal> {
  const count = Math.max(1, opts?.count ?? 3); // champion + 2 challengers
  const lb = await getLeaderboard(loopKey);
  const byTemplate = new Map(lb.map((e) => [e.template_id, e]));
  // explore only this loop's offer subset
  const space = OFFER_CANDIDATES.filter((c) => LOOPS[loopKey].candidateKeys.includes(c.key));

  const chosen: ProposalArm[] = [];
  const usedTemplates = new Set<string>();
  const usedLogics = new Set<string>();

  // champion: best incremental margin/recipient with enough evidence (within this loop's space)
  const champ = lb.find((e) => e.recipients >= CHAMPION_MIN_RECIPIENTS && space.some((c) => c.voucher_template_id === e.template_id));
  if (champ) {
    const cand = space.find((c) => c.voucher_template_id === champ.template_id);
    if (cand) {
      const sign = champ.incr_margin_per_recipient_rm >= 0 ? "+" : "";
      chosen.push({ ...toArmDef(cand, composeMessage(loopKey, cand)), role: "champion", reason: `Best so far: ${sign}RM${champ.incr_margin_per_recipient_rm}/recipient, ${sign}${champ.avg_lift_pp}pp over ${champ.recipients.toLocaleString()} sent (${champ.rounds} ${champ.rounds === 1 ? "round" : "rounds"}).` });
      usedTemplates.add(cand.voucher_template_id);
      usedLogics.add(cand.logic);
    }
  }

  // challengers: least-tested first, preferring an untested logic for spread.
  const pool = space
    .filter((c) => !usedTemplates.has(c.voucher_template_id))
    .sort((a, b) => (byTemplate.get(a.voucher_template_id)?.recipients ?? 0) - (byTemplate.get(b.voucher_template_id)?.recipients ?? 0));

  const addChallenger = (c: OfferCandidate) => {
    const seen = byTemplate.get(c.voucher_template_id);
    const reason = seen
      ? `Re-test — ${seen.recipients.toLocaleString()} sent so far, ${seen.avg_lift_pp >= 0 ? "+" : ""}${seen.avg_lift_pp}pp.`
      : "New logic — never tested yet.";
    chosen.push({ ...toArmDef(c, composeMessage(loopKey, c)), role: "challenger", reason });
    usedTemplates.add(c.voucher_template_id);
    usedLogics.add(c.logic);
  };

  // pass 1: diversify logic
  for (const c of pool) {
    if (chosen.length >= count) break;
    if (!usedLogics.has(c.logic)) addChallenger(c);
  }
  // pass 2: fill remaining slots regardless of logic
  for (const c of pool) {
    if (chosen.length >= count) break;
    if (!usedTemplates.has(c.voucher_template_id)) addChallenger(c);
  }

  return { arms: chosen.slice(0, count) };
}

// ============================================================================
// SEND-TIME — schedule a round + learn the best window (unknown #3).
//
// A round is approved by scheduling it: scheduleRound() sets scheduled_send_at
// and a derived send_window. The /api/cron/loops-send cron calls sendDueRounds()
// every few minutes and fires any prepared round whose time has arrived. Over
// rounds, getSendTimeLeaderboard() pools conversion by window so proposeSendWindow()
// can suggest the best time — the same champion/challenger idea, on the clock.
// ============================================================================

// Day-part windows (Malaysia, UTC+8). Coarse on purpose — enough to learn from.
export const SEND_WINDOWS = [
  "weekday_morning", "weekday_midday", "weekday_evening",
  "weekend_morning", "weekend_midday", "weekend_evening",
] as const;

function deriveWindow(d: Date): string {
  const myt = new Date(d.getTime() + 8 * 3600000); // shift UTC → UTC+8
  const day = myt.getUTCDay(); // 0 Sun .. 6 Sat
  const weekend = day === 0 || day === 6;
  const h = myt.getUTCHours();
  const part = h < 12 ? "morning" : h < 17 ? "midday" : "evening";
  return `${weekend ? "weekend" : "weekday"}_${part}`;
}

// Approve + schedule a prepared round to fire at a chosen time.
export async function scheduleRound(roundId: string, scheduledSendAt: string, sendWindow?: string | null) {
  const { data: round } = await supabaseAdmin.from("loop_rounds").select("status").eq("id", roundId).single();
  if (!round) throw new Error("round not found");
  if (round.status !== "prepared") throw new Error(`can only schedule a prepared round (is ${round.status})`);
  const when = new Date(scheduledSendAt);
  if (Number.isNaN(when.getTime())) throw new Error("invalid scheduled time");
  const win = sendWindow ?? deriveWindow(when);
  const { error } = await supabaseAdmin.from("loop_rounds")
    .update({ scheduled_send_at: when.toISOString(), send_window: win })
    .eq("id", roundId);
  if (error) throw new Error(error.message);
  return { round_id: roundId, scheduled_send_at: when.toISOString(), send_window: win };
}

// Cron entrypoint: fire every prepared round whose scheduled time has passed.
export async function sendDueRounds(nowIso?: string) {
  const now = nowIso ?? new Date().toISOString();
  const { data: due } = await supabaseAdmin.from("loop_rounds")
    .select("id")
    .eq("status", "prepared")
    .not("scheduled_send_at", "is", null)
    .lte("scheduled_send_at", now);
  const results: Array<{ round_id: string; sent?: number; failed?: number; error?: string }> = [];
  for (const r of (due ?? []) as Array<{ id: string }>) {
    try { results.push(await sendRound(r.id)); }
    catch (e) { results.push({ round_id: r.id, error: e instanceof Error ? e.message : "send failed" }); }
  }
  return { fired: results.length, results };
}

type FullStat = { arm: string; n: number; lift_pp: number; conversion_rate: number };
export type SendTimeEntry = { send_window: string; rounds: number; recipients: number; avg_lift_pp: number; avg_order_rate: number };

// Pool measured rounds by the window they were sent in → learn the best time.
export async function getSendTimeLeaderboard(loopKey: LoopKey = "winback"): Promise<SendTimeEntry[]> {
  const { data: rounds } = await supabaseAdmin.from("loop_rounds")
    .select("send_window, stats")
    .eq("loop_key", loopKey).eq("status", "measured").not("send_window", "is", null);

  type Agg = { n: number; liftW: number; orderW: number; rounds: number };
  const agg = new Map<string, Agg>();
  for (const r of (rounds ?? []) as Array<{ send_window: string | null; stats: FullStat[] | null }>) {
    if (!r.send_window || !r.stats) continue;
    let roundN = 0, liftW = 0, orderW = 0;
    for (const s of r.stats) {
      if (s.arm === "holdout") continue;
      roundN += s.n; liftW += (s.lift_pp ?? 0) * s.n; orderW += (s.conversion_rate ?? 0) * s.n;
    }
    if (roundN === 0) continue;
    const e = agg.get(r.send_window) ?? { n: 0, liftW: 0, orderW: 0, rounds: 0 };
    e.n += roundN; e.liftW += liftW; e.orderW += orderW; e.rounds += 1;
    agg.set(r.send_window, e);
  }
  const out: SendTimeEntry[] = [...agg.entries()].map(([w, e]) => ({
    send_window: w, rounds: e.rounds, recipients: e.n,
    avg_lift_pp: +(e.liftW / Math.max(1, e.n)).toFixed(1),
    avg_order_rate: +(e.orderW / Math.max(1, e.n)).toFixed(1),
  }));
  out.sort((a, b) => b.avg_lift_pp - a.avg_lift_pp);
  return out;
}

// Suggest the next send window: best proven (enough evidence) → else explore an
// untested window → else an F&B-sensible default.
export async function proposeSendWindow(loopKey: LoopKey = "winback"): Promise<{ window: string; reason: string }> {
  const lb = await getSendTimeLeaderboard(loopKey);
  const best = lb.find((e) => e.recipients >= CHAMPION_MIN_RECIPIENTS);
  if (best) return { window: best.send_window, reason: `Best window so far: ${best.avg_lift_pp >= 0 ? "+" : ""}${best.avg_lift_pp}pp over ${best.recipients.toLocaleString()} sent.` };
  const tested = new Set(lb.map((e) => e.send_window));
  const untested = SEND_WINDOWS.find((w) => !tested.has(w));
  if (untested) return { window: untested, reason: "New window — never tested yet." };
  return { window: "weekday_evening", reason: "Default — F&B evening peak." };
}

// ============================================================================
// TRIGGERED LOOPS — lifecycle campaigns that fire automatically.
//
// Birthday / Welcome / Reactivation aren't operator-prepared budget blasts;
// they fire per-member as each one crosses the trigger (birthday today / ~1
// day after the 1st visit / just past the inactivity threshold). A daily cron
// calls runTriggeredLoops(): for each, it auto-prepares a round over today's
// NEW qualifiers (minus a cooldown so nobody's hit twice for the same event),
// auto-issues the voucher, and sends immediately. No budget cap, no approval —
// but still a loop: it rotates offers (champion + challengers) and (where set)
// holds out a slice so we keep learning which offer/copy wins.
// ============================================================================

// Phones already targeted by this loop within the cooldown — so a member isn't
// re-birthday'd / re-welcomed / re-reactivated for the same lifecycle event.
async function recentlyTargetedPhones(loopKey: LoopKey, cooldownDays: number): Promise<string[]> {
  const since = new Date(Date.now() - cooldownDays * 86400000).toISOString();
  const { data: rounds } = await supabaseAdmin
    .from("loop_rounds").select("id").eq("loop_key", loopKey).gte("prepared_at", since);
  const roundIds = ((rounds ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (roundIds.length === 0) return [];
  // PAGINATE: Supabase caps a select at 1000 rows. A loop with daily rounds
  // accumulates thousands of assignments in the cooldown window, so an unpaged
  // query truncates the suppress list → already-messaged members slip through and
  // get re-spammed. Page through all of them (ordered by id for stable ranges).
  const phones = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data: rows } = await supabaseAdmin
      .from("loop_assignments").select("phone").in("round_id", roundIds)
      .order("id", { ascending: true }).range(from, from + 999);
    const batch = (rows ?? []) as Array<{ phone: string }>;
    for (const r of batch) if (r.phone) phones.add(r.phone.trim());
    if (batch.length < 1000) break;
  }
  return Array.from(phones);
}

// Has this loop already produced a round today (MYT)? Keeps the cadence at one
// round per loop per day and makes "Run all triggered loops now" idempotent —
// repeat clicks only fire loops that haven't run yet today (no round-stacking),
// while a loop that failed/produced nothing earlier still gets retried.
async function ranToday(loopKey: LoopKey): Promise<boolean> {
  const MYT = 8 * 3600000;
  const since = new Date(Math.floor((Date.now() + MYT) / 86400000) * 86400000 - MYT).toISOString();
  const { data } = await supabaseAdmin
    .from("loop_rounds").select("id").eq("loop_key", loopKey).gte("prepared_at", since).limit(1);
  return (data?.length ?? 0) > 0;
}

// Run one triggered loop: auto-prepare a round over today's new qualifiers,
// then auto-send. Returns a small summary.
async function runTriggeredLoop(def: LoopDef, force = false): Promise<{ loop: LoopKey; qualified: number; sent?: number; failed?: number; round_id?: string; error?: string; skipped?: boolean }> {
  const trig = def.trigger!;
  // Once-a-day guard — unless the operator forces a run (e.g. after widening a
  // segment and wanting it out now). Cooldown still protects already-messaged
  // customers, so a forced run only reaches genuinely new qualifiers.
  if (!force && await ranToday(def.key)) return { loop: def.key, qualified: 0, skipped: true };
  // Reminder loops (noIssue) have no offer space to optimise — the lure is the
  // member's existing voucher — so use the loop's single message arm instead of
  // proposeArms (which returns nothing for an empty candidate set). The holdout
  // still measures whether the reminder lifts ROI vs not-reminding.
  const arms = def.noIssue
    ? [{ key: "reminder", label: "Expiry reminder", voucher_template_id: "", message: def.messageTemplate }]
    : (await proposeArms(def.key)).arms.map((a) => ({ key: a.key, label: a.label, voucher_template_id: a.voucher_template_id, message: a.message }));
  const suppressPhones = await recentlyTargetedPhones(def.key, trig.cooldownDays);
  const preview = await prepareRound(def.key, {
    arms,
    holdoutPct: trig.holdoutPct,
    attributionWindowDays: def.defaultWindowDays,
    segment: trig.segmentOpts,
    suppressPhones,
    createdBy: "cron:loops-trigger",
  });
  if (!preview.round_id || preview.total === 0) return { loop: def.key, qualified: 0 };
  // Backstop: mark it due now so the loops-send cron finishes the send if this
  // request is interrupted mid-way (large batches can exceed the function limit).
  // sendRound is idempotent, so the cron only sends what didn't go out here.
  await supabaseAdmin.from("loop_rounds").update({ scheduled_send_at: new Date().toISOString() }).eq("id", preview.round_id);
  const res = await sendRound(preview.round_id);
  return { loop: def.key, qualified: preview.total, sent: res.sent, failed: res.failed, round_id: preview.round_id, error: res.error };
}

// Cron entrypoint: fire every triggered loop (skip batch/manual ones).
// ── CLOSE THE LOOP: pause what doesn't work ──────────────────────────────────
// app_settings.loops_paused (jsonb object) — key is a loop key ("beans_idle")
// or a round-gap arm ("round_gap:rg_import"); value records when/why. Paused
// entries are skipped by the daily auto-run until an operator clears the key
// from the setting. autoPauseUnderperformers() adds entries itself once pooled
// evidence says a loop/arm isn't lifting — probe → measure → kill, automated.
export type PausedEntry = { at: string; reason: string; auto?: boolean };

export async function getPausedLoops(): Promise<Record<string, PausedEntry>> {
  try {
    const { data } = await supabaseAdmin.from("app_settings").select("value").eq("key", "loops_paused").maybeSingle();
    const v = data?.value;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, PausedEntry>;
  } catch { /* missing/invalid → nothing paused */ }
  return {};
}

export async function pauseLoop(key: string, reason: string, auto = false): Promise<void> {
  const cur = await getPausedLoops();
  if (cur[key]) return; // already paused — keep the original entry
  cur[key] = { at: new Date().toISOString(), reason, ...(auto ? { auto: true } : {}) };
  await supabaseAdmin.from("app_settings").upsert({ key: "loops_paused", value: cur }, { onConflict: "key" });
}

// Evidence floors: enough sends that a dead read isn't noise, but low enough
// that a loser doesn't drain money for months. A paused entry is never
// un-paused automatically — resuming is an operator decision.
const AUTO_PAUSE_MIN_TREATED = 300;   // pooled sends before a verdict counts
const AUTO_PAUSE_MIN_HOLDOUT = 30;    // pooled control behind the lift read
const AUTO_PAUSE_LIFT_FLOOR_PP = 0.5; // lift at/below this after the floors = not working
const AUTO_PAUSE_ARM_CONV_FLOOR = 1;  // round-gap arm % conversion floor (arms share one holdout)

export async function autoPauseUnderperformers(): Promise<Array<{ key: string; reason: string }>> {
  const paused = await getPausedLoops();
  const killed: Array<{ key: string; reason: string }> = [];

  const { data: rounds } = await supabaseAdmin
    .from("loop_rounds").select("loop_key, stats").eq("status", "measured");
  const byLoop = new Map<string, Array<StoredStat[]>>();
  for (const r of (rounds ?? []) as Array<{ loop_key: string; stats: StoredStat[] | null }>) {
    if (!r.stats) continue;
    const l = byLoop.get(r.loop_key) ?? []; l.push(r.stats); byLoop.set(r.loop_key, l);
  }

  // Triggered loops with a control: judge on pooled lift vs pooled holdout —
  // the same honest read the scorecard uses. No control (birthday) → never auto-kill.
  for (const def of Object.values(LOOPS)) {
    if (!def.trigger || !def.trigger.holdoutPct) continue;
    if (paused[def.key]) continue;
    const statsList = byLoop.get(def.key);
    if (!statsList) continue;
    const base = pooledHoldoutBaseline(statsList);
    let n = 0, converted = 0;
    for (const stats of statsList) for (const s of stats) {
      if (s.arm === "holdout") continue;
      n += s.n; converted += s.n * (s.conversion_rate ?? 0) / 100;
    }
    if (n < AUTO_PAUSE_MIN_TREATED || base.n < AUTO_PAUSE_MIN_HOLDOUT) continue;
    const liftPp = (n ? (converted / n) * 100 : 0) - base.convRate;
    if (liftPp <= AUTO_PAUSE_LIFT_FLOOR_PP) {
      const reason = `auto: ${liftPp >= 0 ? "+" : ""}${liftPp.toFixed(1)}pp lift after ${n} sends (holdout ${base.n}) - below ${AUTO_PAUSE_LIFT_FLOOR_PP}pp floor`;
      await pauseLoop(def.key, reason, true);
      killed.push({ key: def.key, reason });
    }
  }

  // Round-gap arms share one unlabelled holdout, so arms are judged on an
  // absolute conversion floor instead of lift.
  const armAgg = new Map<string, { n: number; converted: number }>();
  for (const stats of byLoop.get("round_gap") ?? []) for (const s of stats) {
    if (s.arm === "holdout") continue;
    const a = armAgg.get(s.arm) ?? { n: 0, converted: 0 };
    a.n += s.n; a.converted += s.n * (s.conversion_rate ?? 0) / 100;
    armAgg.set(s.arm, a);
  }
  for (const [arm, a] of armAgg) {
    const key = `round_gap:${arm}`;
    if (paused[key] || a.n < AUTO_PAUSE_MIN_TREATED) continue;
    const conv = (a.converted / a.n) * 100;
    if (conv < AUTO_PAUSE_ARM_CONV_FLOOR) {
      const reason = `auto: ${conv.toFixed(2)}% conversion after ${a.n} sends - below ${AUTO_PAUSE_ARM_CONV_FLOOR}% floor`;
      await pauseLoop(key, reason, true);
      killed.push({ key, reason });
    }
  }
  return killed;
}

export async function runTriggeredLoops(opts?: { force?: boolean }): Promise<Array<{ loop: string; qualified: number; sent?: number; failed?: number; error?: string; skipped?: boolean }>> {
  const out: Array<{ loop: string; qualified: number; sent?: number; failed?: number; error?: string; skipped?: boolean }> = [];
  const paused = await getPausedLoops();
  for (const def of Object.values(LOOPS)) {
    if (!def.trigger) continue;
    if (paused[def.key]) { out.push({ loop: def.key, qualified: 0, skipped: true, error: `paused: ${paused[def.key].reason}` }); continue; }
    try { out.push(await runTriggeredLoop(def, opts?.force)); }
    catch (e) { out.push({ loop: def.key, qualified: 0, error: e instanceof Error ? e.message : "trigger failed" }); }
  }
  return out;
}

// Auto-measure: close the loop for any SENT round whose attribution window has
// elapsed (triggered rounds have no operator to click "Measure"). Idempotent —
// measureRound flips status to 'measured' so it's picked once.
export async function autoMeasureDueRounds(): Promise<{ measured: number }> {
  // Grant rounds (status 'open') accumulate assignments in the order app for
  // meta.round_days, then close to 'sent' so the measure flow below picks
  // them up. The order app also closes them lazily on the next grant; this is
  // the backstop for loops whose grant traffic went quiet mid-round.
  const { data: openRounds } = await supabaseAdmin
    .from("loop_rounds").select("id, prepared_at, meta").eq("status", "open");
  for (const r of (openRounds ?? []) as Array<{ id: string; prepared_at: string | null; meta: { round_days?: number } | null }>) {
    if (!r.prepared_at) continue;
    const days = Number(r.meta?.round_days ?? 7);
    if (Date.now() < new Date(r.prepared_at).getTime() + days * 86400000) continue;
    await supabaseAdmin.from("loop_rounds")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", r.id).eq("status", "open");
  }

  const { data: rounds } = await supabaseAdmin
    .from("loop_rounds").select("id, sent_at, attribution_window_days").eq("status", "sent");
  let measured = 0;
  const nowMs = Date.now();
  for (const r of (rounds ?? []) as Array<{ id: string; sent_at: string | null; attribution_window_days: number }>) {
    if (!r.sent_at) continue;
    const dueMs = new Date(r.sent_at).getTime() + r.attribution_window_days * 86400000;
    if (nowMs < dueMs) continue;
    try { await measureRound(r.id); measured++; } catch { /* leave for next run */ }
  }
  return { measured };
}

// ============================================================================
// ROUND-GAP AUTO-RUN — same daily lifecycle as the triggered loops, but its own
// mechanic (per-segment promo via loyalty_round_gap_prepare, not vouchers). The
// daily cron prepares the next capped batch per campaign and auto-sends it, so
// round-gap "follows the same as the other SMS loops" — no manual round cards.
// Kill-switch: app_settings.round_gap_auto_enabled = 'false' pauses it.
// ============================================================================
export type RoundGapArm = { key: "rg_skipper" | "rg_import"; label: string; message: string; min_order: number };
export const ROUND_GAP_CAMPAIGNS: Record<string, {
  outlet: string; round_start: number; round_end: number; name: string; daily_limit: number; arms: RoundGapArm[];
}> = {
  // Breakfast round = 08-10 MYT (outlets open at 8, not 7) per the canonical
  // rounds (reference: celsius-rounds memory / ROUNDS in storehub-helpers).
  "conezion-breakfast": {
    outlet: "conezion", round_start: 8, round_end: 10, name: "Conezion · Breakfast", daily_limit: 50,
    arms: [
      { key: "rg_skipper", min_order: 35, label: "Regular · free coffee, spend RM35 (8-10am)",
        message: "Hi {name}! Free coffee at Celsius Conezion breakfast (8-10am) this week, spend RM35. We miss you in the AM! Show your number." },
      { key: "rg_import", min_order: 25, label: "Win-back · free coffee, spend RM25 (8-10am)",
        message: "Hi {name}! We miss you at Celsius Conezion. Free coffee at breakfast (8-10am) this week, spend RM25. Show your number." },
    ],
  },
  "shah-alam-evening": {
    outlet: "shah-alam", round_start: 17, round_end: 19, name: "Shah Alam · Evening", daily_limit: 50,
    arms: [
      { key: "rg_skipper", min_order: 40, label: "Regular · free coffee, spend RM40 (5-7pm)",
        message: "Hi {name}! Free coffee at Celsius Shah Alam (5-7pm) this week, spend RM40. We rarely see you in the evening! Show your number." },
      { key: "rg_import", min_order: 25, label: "Win-back · free coffee, spend RM25 (5-7pm)",
        message: "Hi {name}! We miss you at Celsius Shah Alam. Free coffee (5-7pm) this week, spend RM25. Show your number." },
    ],
  },
  // Tamarind: low-volume outlet with no weak-round gap, but ~554 dormant customers
  // recovered from the StoreHub archive (tag 'Tamarind', never ordered native). This
  // is a WIN-BACK play, not a daypart fill — so the window spans the full open day
  // (08-23 MYT per the canonical rounds) for max redemption flexibility; the skipper
  // arm is ~empty by design, the import arm is the point.
  "tamarind-winback": {
    outlet: "tamarind", round_start: 8, round_end: 23, name: "Tamarind · Win-back", daily_limit: 50,
    arms: [
      { key: "rg_skipper", min_order: 30, label: "Regular · free coffee, spend RM30",
        message: "Hi {name}! Free coffee at Celsius Tamarind this week, spend RM30. We miss you - show your number to redeem." },
      { key: "rg_import", min_order: 25, label: "Win-back · free coffee, spend RM25",
        message: "Hi {name}! We miss you at Celsius Tamarind. Free coffee this week when you spend RM25 - show your number to redeem." },
    ],
  },
};

// Auto-run the round-gap campaigns: prepare the next capped batch per campaign
// and send it immediately. Idempotent — skips a campaign already run in the last
// 20h, so the daily cron (or a manual re-trigger) can't double-send; force
// bypasses that guard. Holdout + measurement are handled by the prepare RPC +
// autoMeasureDueRounds, exactly like the other loops.
export async function runRoundGapDaily(opts?: { force?: boolean }): Promise<Array<{ campaign: string; prepared?: number; sent?: number; failed?: number; skipped?: boolean; error?: string }>> {
  const out: Array<{ campaign: string; prepared?: number; sent?: number; failed?: number; skipped?: boolean; error?: string }> = [];
  try {
    const { data: s } = await supabaseAdmin.from("app_settings").select("value").eq("key", "round_gap_auto_enabled").maybeSingle();
    if ((s?.value ?? "").toString().trim().toLowerCase() === "false") {
      return [{ campaign: "all", skipped: true, error: "round_gap_auto_enabled=false" }];
    }
  } catch { /* missing setting → default enabled */ }

  const sinceIso = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
  const paused = await getPausedLoops();
  for (const [key, cfg] of Object.entries(ROUND_GAP_CAMPAIGNS)) {
    try {
      // An arm paused (manually or by autoPauseUnderperformers) stops being
      // prepared/sent; the other arm keeps running. All arms paused → campaign idles.
      const arms = cfg.arms.filter((a) => !paused[`round_gap:${a.key}`]);
      if (!arms.length) { out.push({ campaign: key, skipped: true, error: "all arms paused" }); continue; }
      if (!opts?.force) {
        const { data: recent } = await supabaseAdmin
          .from("loop_rounds").select("id")
          .eq("loop_key", "round_gap").filter("meta->>outlet", "eq", cfg.outlet)
          .gte("prepared_at", sinceIso).limit(1);
        if (recent && recent.length) { out.push({ campaign: key, skipped: true }); continue; }
      }
      const { data, error } = await supabaseAdmin.rpc("loyalty_round_gap_prepare", {
        p_outlet: cfg.outlet, p_round_start: cfg.round_start, p_round_end: cfg.round_end,
        p_round_name: cfg.name, p_arms: arms, p_holdout_pct: 10, p_window_days: 7, p_limit: cfg.daily_limit,
      });
      if (error) throw new Error(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.round_id) { out.push({ campaign: key, prepared: 0 }); continue; } // pool drained
      const res = await sendRound(row.round_id);
      out.push({ campaign: key, prepared: row.treated, sent: res.sent, failed: res.failed });
    } catch (e) {
      out.push({ campaign: key, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return out;
}

// Revert a PREPARED round — delete the un-sent (active) vouchers it issued, its
// assignments, and the round itself. Only valid before send: a sent round has
// live SMS in customers' hands, so it can't be un-done. Redeemed vouchers (rare
// pre-send) are left intact so order history isn't broken.
export async function cancelRound(roundId: string): Promise<{ vouchers: number; assignments: number }> {
  const { data: round } = await supabaseAdmin.from("loop_rounds").select("status").eq("id", roundId).single();
  if (!round) throw new Error("round not found");
  if (round.status !== "prepared") throw new Error(`can only cancel a prepared round (this one is '${round.status}')`);
  const { data: ir } = await supabaseAdmin.from("issued_rewards").delete().eq("source_ref_id", roundId).eq("status", "active").select("id");
  const { data: la } = await supabaseAdmin.from("loop_assignments").delete().eq("round_id", roundId).select("id");
  await supabaseAdmin.from("loop_rounds").delete().eq("id", roundId);
  return { vouchers: (ir ?? []).length, assignments: (la ?? []).length };
}

// ============================================================================
// EVALUATION — cross-loop rollup for the campaigns overview dashboard.
// Pools every MEASURED round across all loops into a grand total + per-loop
// breakdown: SMS sent/cost, redemptions, incremental orders + margin vs the
// holdout, and ROI. Answers "is the whole programme working?" at a glance.
// ============================================================================
type EvalStat = { arm: string; n: number; lift_pp: number; redemption_rate: number; revenue_per_recipient_rm: number; conversion_rate?: number; revenue_rm?: number };
export type LoopEval = {
  loop_key: string; label: string; rounds: number; sent: number;
  redemptions: number; redemption_rate: number; avg_lift_pp: number;
  /** Pooled holdout size behind avg_lift_pp — small n = low-confidence lift. */
  holdout_n: number;
  incremental_orders: number; incremental_margin_rm: number; sms_cost_rm: number; roi: number;
};
// Live activity — available immediately (every sent/measured round), so the
// operator isn't blind during the attribution window before "measured" results.
export type LiveLoop = {
  loop_key: string; label: string;
  rounds: number; in_flight: number;       // rounds total / still measuring
  sent: number; vouchers: number; redeemed: number;
  orders: number; revenue_rm: number;      // attributed so far (gross, not incremental)
  sms_cost_rm: number; redeemed_rate: number;
  next_results_at: string | null;          // ISO — when the earliest in-flight round measures
};
export type LiveRollup = { per_loop: LiveLoop[]; totals: Omit<LiveLoop, "loop_key" | "label"> };
export type Evaluation = { per_loop: LoopEval[]; totals: Omit<LoopEval, "loop_key" | "label">; live: LiveRollup };

export async function getEvaluation(opts?: { sinceDays?: number }): Promise<Evaluation> {
  let query = supabaseAdmin
    .from("loop_rounds").select("loop_key, stats").eq("status", "measured");
  // Optional date window — filter to campaigns SENT within the last N days.
  if (opts?.sinceDays && opts.sinceDays > 0) {
    query = query.gte("sent_at", new Date(Date.now() - opts.sinceDays * 86400000).toISOString());
  }
  const { data: rounds } = await query;

  // Group each loop's measured rounds, pool the holdouts into ONE baseline,
  // then pool treated conversions/revenue against it (see pooledHoldoutBaseline
  // — per-round holdouts are noise).
  const roundsByLoop = new Map<string, Array<EvalStat[]>>();
  for (const r of (rounds ?? []) as Array<{ loop_key: string; stats: EvalStat[] | null }>) {
    if (!r.stats) continue;
    const list = roundsByLoop.get(r.loop_key) ?? [];
    list.push(r.stats);
    roundsByLoop.set(r.loop_key, list);
  }

  type Acc = { rounds: number; sent: number; redemptions: number; liftW: number; incrOrders: number; incrMargin: number; holdoutN: number };
  const blank = (): Acc => ({ rounds: 0, sent: 0, redemptions: 0, liftW: 0, incrOrders: 0, incrMargin: 0, holdoutN: 0 });
  const byLoop = new Map<string, Acc>();

  for (const [loopKey, statsList] of roundsByLoop) {
    const base = pooledHoldoutBaseline(statsList);
    const acc = blank();
    acc.holdoutN = base.n;
    let converted = 0, revenue = 0;
    for (const stats of statsList) {
      let counted = false;
      for (const s of stats) {
        if (s.arm === "holdout") continue;
        counted = true;
        acc.sent += s.n;
        acc.redemptions += Math.round(s.n * (s.redemption_rate ?? 0) / 100);
        converted += s.n * (s.conversion_rate ?? 0) / 100;
        revenue += s.revenue_rm ?? (s.revenue_per_recipient_rm ?? 0) * s.n;
      }
      if (counted) acc.rounds += 1;
    }
    const convRate = acc.sent ? (converted / acc.sent) * 100 : 0;
    const revPer = acc.sent ? revenue / acc.sent : 0;
    // NO CONTROL, NO INCREMENTAL CLAIM: a loop with zero pooled holdouts
    // (birthday runs holdoutPct 0 by design) has no baseline — subtracting a
    // zero baseline would book EVERY attributed order/ringgit as incremental
    // and inflate the programme totals. Report 0 lift/incremental instead;
    // holdout_n = 0 tells the dashboard to render it as "uncontrolled".
    // (Redemptions/sent stay — those are directly observed, not modelled.)
    const controlled = base.n > 0;
    const liftPp = controlled ? convRate - base.convRate : 0;
    acc.liftW = liftPp * acc.sent; // keep weighted form so totals pool correctly
    acc.incrOrders = controlled ? acc.sent * liftPp / 100 : 0;
    acc.incrMargin = controlled ? (revPer - base.revPerRecipient) * acc.sent * GP : 0;
    byLoop.set(loopKey, acc);
  }

  const toEval = (loop_key: string, a: Acc): LoopEval => {
    // Conservative: bills every send as SMS. Push sends are free, so this is an
    // UPPER bound on cost (→ ROI is understated, never overstated). Make it
    // channel-accurate via loop_assignments.channel once push volume is material.
    // Grant loops send nothing at all — their delivery cost is genuinely zero
    // (the reward COGS shows up in margin, not here).
    const sms = LOOPS[loop_key as LoopKey]?.grant ? 0 : +(a.sent * SMS_COST_RM).toFixed(2);
    return {
      loop_key, label: LOOPS[loop_key as LoopKey]?.label ?? loop_key,
      rounds: a.rounds, sent: a.sent, redemptions: a.redemptions,
      redemption_rate: +(a.sent ? (a.redemptions / a.sent) * 100 : 0).toFixed(1),
      avg_lift_pp: +(a.sent ? a.liftW / a.sent : 0).toFixed(1),
      holdout_n: a.holdoutN,
      incremental_orders: Math.round(a.incrOrders),
      incremental_margin_rm: +a.incrMargin.toFixed(2),
      sms_cost_rm: sms,
      roi: sms > 0 ? +(a.incrMargin / sms).toFixed(1) : 0,
    };
  };

  const per_loop = [...byLoop.entries()].map(([k, a]) => toEval(k, a)).sort((x, y) => y.incremental_margin_rm - x.incremental_margin_rm);
  const tAcc = blank();
  for (const a of byLoop.values()) { tAcc.rounds += a.rounds; tAcc.sent += a.sent; tAcc.redemptions += a.redemptions; tAcc.liftW += a.liftW; tAcc.incrOrders += a.incrOrders; tAcc.incrMargin += a.incrMargin; tAcc.holdoutN += a.holdoutN; }
  const { loop_key: _k, label: _l, ...totals } = toEval("__totals__", tAcc);
  void _k; void _l;
  // Re-derive total cost from the per-loop rows — toEval("__totals__") can't
  // know which loops are grant (zero-cost), so it would bill their sends.
  totals.sms_cost_rm = +per_loop.reduce((s, l) => s + l.sms_cost_rm, 0).toFixed(2);
  totals.roi = totals.sms_cost_rm > 0 ? +(totals.incremental_margin_rm / totals.sms_cost_rm).toFixed(1) : 0;

  // ── LIVE activity (server-side aggregate via RPC; UNCAPPED) ──────────────────
  // Available immediately (not gated on the attribution window). The old JS path
  // fetched assignment / voucher / order rows via .in(...), which Supabase caps at
  // 1000 rows — so the scorecard silently undercounted once volume passed ~1000
  // (it read 881 when 1904 had actually sent). The RPC aggregates uncapped in one
  // query: SMS sent, vouchers, redemptions, attributed orders/revenue, next window.
  const { data: liveRows, error: liveErr } = await supabaseAdmin.rpc("loyalty_loops_live_rollup", {
    p_since_days: opts?.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : null,
  });
  if (liveErr) throw new Error(`live rollup: ${liveErr.message}`);
  type RollupRow = { loop_key: string; rounds: number; in_flight: number; sent: number; vouchers: number; redeemed: number; orders: number; revenue_rm: number | string; next_results_at: string | null };
  const toLive = (row: RollupRow): LiveLoop => {
    const sent = Number(row.sent), vouchers = Number(row.vouchers), redeemed = Number(row.redeemed);
    return {
      loop_key: row.loop_key, label: LOOPS[row.loop_key as LoopKey]?.label ?? row.loop_key,
      rounds: Number(row.rounds), in_flight: Number(row.in_flight),
      sent, vouchers, redeemed, orders: Number(row.orders),
      revenue_rm: +Number(row.revenue_rm).toFixed(2),
      sms_cost_rm: +(sent * SMS_COST_RM).toFixed(2),
      redeemed_rate: +(vouchers ? (redeemed / vouchers) * 100 : 0).toFixed(1),
      next_results_at: row.next_results_at ?? null,
    };
  };
  const livePerLoop = ((liveRows ?? []) as RollupRow[]).map(toLive).sort((x, y) => y.sent - x.sent);
  const lt = livePerLoop.reduce(
    (a, l) => {
      a.rounds += l.rounds; a.in_flight += l.in_flight; a.sent += l.sent; a.vouchers += l.vouchers;
      a.redeemed += l.redeemed; a.orders += l.orders; a.revenue_rm += l.revenue_rm;
      if (l.next_results_at && (a.next === null || l.next_results_at < a.next)) a.next = l.next_results_at;
      return a;
    },
    { rounds: 0, in_flight: 0, sent: 0, vouchers: 0, redeemed: 0, orders: 0, revenue_rm: 0, next: null as string | null },
  );
  const liveTotals: Omit<LiveLoop, "loop_key" | "label"> = {
    rounds: lt.rounds, in_flight: lt.in_flight, sent: lt.sent, vouchers: lt.vouchers, redeemed: lt.redeemed,
    orders: lt.orders, revenue_rm: +lt.revenue_rm.toFixed(2),
    sms_cost_rm: +(lt.sent * SMS_COST_RM).toFixed(2),
    redeemed_rate: +(lt.vouchers ? (lt.redeemed / lt.vouchers) * 100 : 0).toFixed(1),
    next_results_at: lt.next,
  };
  const live: LiveRollup = { per_loop: livePerLoop, totals: liveTotals };

  return { per_loop, totals, live };
}
