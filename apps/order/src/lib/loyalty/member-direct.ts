// Direct member find-or-create against Supabase. Replaces the previous
// loyalty-app proxy path (POST /api/members on loyalty.celsiuscoffee.com)
// so pickup-app signups produce the same row shape as backoffice-admin
// signups — single source of truth, no proxy filtering fields.
//
// Mirrors the logic at
// apps/backoffice/src/app/api/loyalty/members/route.ts (POST) so a
// member created by either surface is indistinguishable in the DB.

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { phoneVariants, canonicalPhone as canonicaliseInsertPhone } from "@/lib/phone";

const BRAND_ID = (process.env.LOYALTY_BRAND_ID ?? "brand-celsius").trim();

export type MemberRow = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  birthday: string | null;
  points_balance: number;
  total_points_earned: number;
  total_visits: number;
};

/** Find by any phone-variant, otherwise create a fresh members +
 *  member_brands row pair. Returns the canonical member shape used
 *  by every customer-facing endpoint in the order app. */
export async function findOrCreateMember(phone: string): Promise<MemberRow | null> {
  const supabase = getSupabaseAdmin();
  const variants = phoneVariants(phone);

  // 1) Lookup
  const { data: existing } = await supabase
    .from("members")
    .select("id, phone, name, email, birthday")
    .in("phone", variants)
    .limit(1);

  type RawMember = {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    birthday: string | null;
  };

  let memberRow = existing && existing.length > 0
    ? (existing[0] as RawMember)
    : null;

  // 2) Create if missing
  if (!memberRow) {
    const newId = `member-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const canonicalPhone = canonicaliseInsertPhone(phone);
    const { data: inserted, error: insertErr } = await supabase
      .from("members")
      .insert({
        id: newId,
        phone: canonicalPhone,
        name: null,
        email: null,
        birthday: null,
        sms_opt_out: false,
        consent_at: new Date().toISOString(),
      })
      .select("id, phone, name, email, birthday")
      .single();
    if (insertErr || !inserted) {
      console.error("[member-direct] members insert failed", insertErr?.message);
      return null;
    }
    memberRow = inserted as RawMember;
  }

  // 3) Ensure brand enrollment (idempotent — if the row already
  //    exists this is a no-op via the ON CONFLICT path).
  const { data: brandRow } = await supabase
    .from("member_brands")
    .select("points_balance, total_points_earned, total_visits")
    .eq("member_id", memberRow.id)
    .eq("brand_id", BRAND_ID)
    .maybeSingle();

  if (!brandRow) {
    const mbId = `mb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await supabase
      .from("member_brands")
      .insert({
        id: mbId,
        member_id: memberRow.id,
        brand_id: BRAND_ID,
        points_balance: 0,
        total_points_earned: 0,
        total_points_redeemed: 0,
        total_visits: 0,
        total_spent: 0,
      });
  }

  return {
    id:                  memberRow.id,
    phone:               memberRow.phone,
    name:                memberRow.name ?? null,
    email:               memberRow.email ?? null,
    birthday:            memberRow.birthday ?? null,
    points_balance:      (brandRow?.points_balance as number | null)       ?? 0,
    total_points_earned: (brandRow?.total_points_earned as number | null)  ?? 0,
    total_visits:        (brandRow?.total_visits as number | null)         ?? 0,
  };
}

/** Resolve a phone to an existing member id WITHOUT creating one. Returns
 *  null when no member matches any phone variant. Used by the v2 /me/*
 *  session resolver's fallback when a (legacy) session token carries no
 *  member_id — replaces a proxy hop to loyalty.celsiuscoffee.com/api/members. */
export async function lookupMemberIdByPhone(phone: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("members")
    .select("id")
    .in("phone", phoneVariants(phone))
    .limit(1);
  return data && data.length > 0 ? (data[0] as { id: string }).id : null;
}
