// POST /api/loyalty/referral/attribute — called during signup when the
// new member entered a referral code on the welcome screen.
//
// Body: { code: string }  (member resolved from Bearer session)
//
// Records a pending attribution. Both-side rewards land when the new
// member completes their first paid order (hooked in confirm-stripe).

import { NextRequest, NextResponse } from "next/server";
import { resolveMember } from "@/lib/loyalty/v2-auth";
import { attributeReferralOnSignup } from "@/lib/loyalty/v2";

export async function POST(req: NextRequest) {
  const r = await resolveMember(req);
  if (r.error) return r.error as unknown as NextResponse;

  const body = await req.json().catch(() => null);
  const code = (body?.code as string | undefined)?.trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const result = await attributeReferralOnSignup({
    refereeId: r.member.memberId,
    code,
  });
  if (!result.ok) {
    // Map structured reason → customer-facing message. Reason is also
    // returned in the body so the client can decide whether to show
    // the error inline, silently swallow it, or hide the field on
    // future renders.
    const messageFor = (reason: typeof result.reason) => {
      switch (reason) {
        case "self":
          return "You can't use your own referral code.";
        case "not_new":
          return "Referral codes can only be used on a brand-new account.";
        case "duplicate":
          return "You've already used a referral code on this account.";
        case "not_found":
          return "That referral code doesn't exist.";
        default:
          return "Couldn't apply the referral code. Try again in a moment.";
      }
    };
    return NextResponse.json(
      { error: messageFor(result.reason), reason: result.reason ?? "error" },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true });
}
