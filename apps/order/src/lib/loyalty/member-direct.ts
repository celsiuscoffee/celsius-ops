// Direct member find-or-create against Supabase. Replaces the previous
// loyalty-app proxy path (POST /api/members on loyalty.celsiuscoffee.com)
// so pickup-app signups produce the same row shape as backoffice-admin
// signups — single source of truth, no proxy filtering fields.
//
// Mirrors the logic at
// apps/backoffice/src/app/api/loyalty/members/route.ts (POST) so a
// member created by either surface is indistinguishable in the DB.

import { getSupabaseAdmin } from "@/lib/supabase/server";

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

/** Phone variants — covers the three common Malaysian formats so a
 *  signup with "+60123456789" finds the existing "0123456789" row
 *  instead of creating a duplicate. Same logic the backoffice uses. */
function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const variants: string[] = [phone];
  if (d.startsWith("60")) {
    variants.push(`+${d}`, d, `0${d.slice(2)}`);
  } else if (d.startsWith("0")) {
    variants.push(`+6${d}`, `6${d}`, d);
  } else {
    variants.push(`+60${d}`, `60${d}`, `0${d}`);
  }
  return [...new Set(variants)];
}

/** Canonical form we INSERT under when creating fresh rows. Pickup
 *  signups always come in as +60xxx (OTP send normalises before
 *  delivery), so we standardise here too. */
function canonicaliseInsertPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("60")) return `+${d}`;
  if (d.startsWith("0")) return `+6${d}`;
  return `+60${d}`;
}

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
