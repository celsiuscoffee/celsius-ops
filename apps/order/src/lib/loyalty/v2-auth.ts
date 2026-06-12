// v2-auth.ts — resolves the customer session into a member_id for the
// new rewards-v2 endpoints. STRICT mode required (no anonymous /me/*).

import type { NextRequest } from "next/server";
import { requireCustomerSession } from "@/lib/customer-jwt";

const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();
const BRAND_ID     = (process.env.LOYALTY_BRAND_ID  ?? "brand-celsius").trim();

export type ResolvedMember = {
  memberId: string;
  phone: string;
};

export async function resolveMember(req: NextRequest): Promise<
  { member: ResolvedMember; error: null }
  | { member: null; error: Response }
> {
  const guard = requireCustomerSession(req);
  if (guard.error) return { member: null, error: guard.error as Response };

  // STRICT_CUSTOMER_AUTH off + no token → reject; /me/* endpoints are
  // always member-scoped and must not fall through to body-trust.
  if (!guard.session) {
    return {
      member: null,
      error: Response.json({ error: "Member session required" }, { status: 401 }),
    };
  }

  // sub is the member_id when known; falls back to phone lookup if empty.
  if (guard.session.sub) {
    return { member: { memberId: guard.session.sub, phone: guard.session.phone }, error: null };
  }

  try {
    const res = await fetch(
      `${LOYALTY_BASE}/api/members?brand_id=${BRAND_ID}&phone=${encodeURIComponent(guard.session.phone)}`,
      { headers: { "Content-Type": "application/json" } },
    );
    const rows = await res.json();
    const member = Array.isArray(rows) && rows[0];
    if (!member?.id) {
      return {
        member: null,
        error: Response.json({ error: "Member not found" }, { status: 404 }),
      };
    }
    return { member: { memberId: member.id as string, phone: guard.session.phone }, error: null };
  } catch {
    return {
      member: null,
      error: Response.json({ error: "Member lookup failed" }, { status: 502 }),
    };
  }
}
