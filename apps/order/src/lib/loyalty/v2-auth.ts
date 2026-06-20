// v2-auth.ts — resolves the customer session into a member_id for the
// new rewards-v2 endpoints. STRICT mode required (no anonymous /me/*).

import type { NextRequest } from "next/server";
import { requireCustomerSession } from "@/lib/customer-jwt";
import { lookupMemberIdByPhone } from "./member-direct";

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

  // Legacy fallback: a session token minted before member rows were always
  // created at OTP verify can carry an empty `sub`. Resolve phone → member id
  // directly against the shared Supabase (same store the rest of the app uses)
  // instead of proxying to loyalty.celsiuscoffee.com.
  try {
    const memberId = await lookupMemberIdByPhone(guard.session.phone);
    if (!memberId) {
      return {
        member: null,
        error: Response.json({ error: "Member not found" }, { status: 404 }),
      };
    }
    return { member: { memberId, phone: guard.session.phone }, error: null };
  } catch {
    return {
      member: null,
      error: Response.json({ error: "Member lookup failed" }, { status: 502 }),
    };
  }
}
