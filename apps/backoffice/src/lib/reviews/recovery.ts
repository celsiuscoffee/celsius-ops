/**
 * Service-recovery helpers for the negative-review case manager.
 *
 * A negative review's approved reply carries a single-use recovery code. The
 * customer enters it on the public form, which captures their phone into
 * loyalty and issues a voucher TAGGED to the originating review (source_ref_id
 * = caseId), so every free item traces back to a specific approved complaint.
 */
import { supabaseAdmin } from "@/lib/loyalty/supabase";
import { issueReward } from "@/lib/loyalty/loop-engine";
import { prisma } from "@/lib/prisma";

const BRAND = "brand-celsius";

// Free Coffee — low-COGS, margin-safe (voucher_templates).
export const RECOVERY_VOUCHER_TEMPLATE = "206b5fbf-c12a-44e5-ad30-85a9e8a81439";

// No ambiguous chars (0/O/1/I/L) so a customer can read it off a plain-text
// Google reply and type it without confusion.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function genRecoveryCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const variants: string[] = [phone];
  if (d.startsWith("60")) variants.push(`+${d}`, d, `0${d.slice(2)}`);
  else if (d.startsWith("0")) variants.push(`+6${d}`, `6${d}`, d);
  else variants.push(`+60${d}`, `60${d}`, `0${d}`);
  return [...new Set(variants)];
}

function canonicalisePhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("60")) return `+${d}`;
  if (d.startsWith("0")) return `+6${d}`;
  return `+60${d}`;
}

/** Basic sanity check for a Malaysian mobile (after stripping non-digits). */
export function isValidMyPhone(phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  // 01XXXXXXXX (10-11 digits) or 601XXXXXXXX
  return /^(0|60)1\d{7,9}$/.test(d);
}

/**
 * Find a member by any phone variant, else create one. Mirrors the order app's
 * findOrCreateMember row shape so a recovered customer is indistinguishable
 * from any other signup. Fills name on create / when previously blank.
 */
export async function findOrCreateMemberByPhone(
  phone: string,
  name?: string | null,
): Promise<{ id: string; isNew: boolean } | null> {
  const variants = phoneVariants(phone);

  const { data: existing } = await supabaseAdmin
    .from("members")
    .select("id, name")
    .in("phone", variants)
    .limit(1);

  let memberId: string;
  let isNew = false;

  if (existing && existing.length > 0) {
    memberId = (existing[0] as { id: string }).id;
    if (name && !(existing[0] as { name: string | null }).name) {
      await supabaseAdmin.from("members").update({ name }).eq("id", memberId);
    }
  } else {
    const newId = `member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: inserted, error } = await supabaseAdmin
      .from("members")
      .insert({
        id: newId,
        phone: canonicalisePhone(phone),
        name: name ?? null,
        email: null,
        birthday: null,
        sms_opt_out: false,
        consent_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !inserted) {
      console.error("[recovery] member insert failed", error?.message);
      return null;
    }
    memberId = (inserted as { id: string }).id;
    isNew = true;
  }

  // Ensure brand enrollment (idempotent).
  const { data: brandRow } = await supabaseAdmin
    .from("member_brands")
    .select("id")
    .eq("member_id", memberId)
    .eq("brand_id", BRAND)
    .maybeSingle();
  if (!brandRow) {
    await supabaseAdmin.from("member_brands").insert({
      id: `mb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      member_id: memberId,
      brand_id: BRAND,
      points_balance: 0,
      total_points_earned: 0,
      total_points_redeemed: 0,
      total_visits: 0,
      total_spent: 0,
    });
  }

  return { id: memberId, isNew };
}

/** Has this member already been issued a recovery voucher? (one-per-member gate) */
export async function hasRecoveryVoucher(memberId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("issued_rewards")
    .select("id")
    .eq("member_id", memberId)
    .eq("source_type", "recovery")
    .limit(1);
  return !!(data && data.length > 0);
}

/** Issue the recovery voucher, tagged to the case (review) for audit + dedup. */
export async function issueRecoveryVoucher(
  memberId: string,
  caseId: string,
): Promise<{ id: string } | null> {
  const res = await issueReward(memberId, RECOVERY_VOUCHER_TEMPLATE, caseId, "recovery");
  return res ? { id: res.id } : null;
}

export type CompensateResult =
  | { ok: true; alreadyCompensated: boolean; memberId: string; rewardId: string | null }
  | { ok: false; error: string };

/**
 * Capture a customer into loyalty + issue the recovery voucher for a case, then
 * move the case to "compensated". Shared by the public recovery form (claimed
 * via code) and the manager's manual-compensate action. Idempotent: a case
 * already compensated/resolved returns its existing linkage; a member who
 * already holds a recovery voucher isn't double-issued.
 */
export async function compensateReviewCase(
  caseId: string,
  phone: string,
  name?: string | null,
): Promise<CompensateResult> {
  const c = await prisma.reviewReplyDraft.findUnique({ where: { id: caseId } });
  if (!c) return { ok: false, error: "Case not found" };
  if (c.status === "compensated" || c.status === "resolved") {
    return {
      ok: true,
      alreadyCompensated: true,
      memberId: c.recoveryMemberId ?? "",
      rewardId: c.recoveryRewardId,
    };
  }
  if (c.status !== "approved") {
    return { ok: false, error: `This case is ${c.status}, not awaiting recovery` };
  }
  if (!isValidMyPhone(phone)) return { ok: false, error: "Enter a valid Malaysian mobile number" };

  const member = await findOrCreateMemberByPhone(phone, name);
  if (!member) return { ok: false, error: "Could not create loyalty member" };

  let rewardId: string | null = null;
  if (!(await hasRecoveryVoucher(member.id))) {
    const voucher = await issueRecoveryVoucher(member.id, caseId);
    if (!voucher) return { ok: false, error: "Could not issue voucher" };
    rewardId = voucher.id;
  }

  await prisma.reviewReplyDraft.update({
    where: { id: caseId },
    data: {
      status: "compensated",
      claimedAt: new Date(),
      recoveryMemberId: member.id,
      recoveryRewardId: rewardId ?? c.recoveryRewardId,
    },
  });

  return { ok: true, alreadyCompensated: false, memberId: member.id, rewardId };
}

/**
 * Compensate an internal QR-feedback case. Unlike a Google review we already
 * have the customer's phone, so there's no recovery code — a manager issues the
 * voucher directly. Falls back to the phone stored on the feedback row.
 */
export async function compensateInternalFeedback(
  feedbackId: string,
  phoneOverride?: string | null,
  name?: string | null,
): Promise<CompensateResult> {
  const fb = await prisma.internalFeedback.findUnique({ where: { id: feedbackId } });
  if (!fb) return { ok: false, error: "Feedback not found" };
  if (fb.status === "compensated" || fb.status === "resolved") {
    return {
      ok: true,
      alreadyCompensated: true,
      memberId: fb.recoveryMemberId ?? "",
      rewardId: fb.recoveryRewardId,
    };
  }
  if (fb.status !== "open") {
    return { ok: false, error: `This feedback is ${fb.status}` };
  }

  const phone = (phoneOverride && phoneOverride.trim()) || fb.phone || "";
  if (!isValidMyPhone(phone)) {
    return { ok: false, error: "No valid phone on this feedback — enter one" };
  }

  const member = await findOrCreateMemberByPhone(phone, name ?? fb.name);
  if (!member) return { ok: false, error: "Could not create loyalty member" };

  let rewardId: string | null = null;
  if (!(await hasRecoveryVoucher(member.id))) {
    const voucher = await issueRecoveryVoucher(member.id, feedbackId);
    if (!voucher) return { ok: false, error: "Could not issue voucher" };
    rewardId = voucher.id;
  }

  await prisma.internalFeedback.update({
    where: { id: feedbackId },
    data: {
      status: "compensated",
      compensatedAt: new Date(),
      recoveryMemberId: member.id,
      recoveryRewardId: rewardId ?? fb.recoveryRewardId,
    },
  });

  return { ok: true, alreadyCompensated: false, memberId: member.id, rewardId };
}
