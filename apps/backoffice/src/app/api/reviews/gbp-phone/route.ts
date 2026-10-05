import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getLocationPhones, updateLocationPhone } from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Loose sanity check, not a validator: GBP itself rejects malformed numbers,
// this only stops an obviously-mangled query param from being PATCHed at all
// four listings in one click.
const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;

// GET /api/reviews/gbp-phone?number=...[&apply=1] — set the Google Business
// Profile primary phone number on every connected outlet. Dry-run by default:
// shows each listing's current primary + additional numbers next to the wanted
// one so the change can be eyeballed before ?apply=1 PATCHes it. Additional
// phones are preserved verbatim (the phoneNumbers updateMask swaps the whole
// object, so they'd silently vanish otherwise).
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) {
    try {
      await requireRole(request.headers, "ADMIN");
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const url = new URL(request.url);
  const apply = url.searchParams.get("apply") === "1";
  const number = url.searchParams.get("number")?.trim() ?? "";

  if (!PHONE_RE.test(number)) {
    return NextResponse.json(
      { error: "Pass ?number=+60 11-XXXX XXXX (digits, spaces, dashes; optional leading +)" },
      { status: 400 },
    );
  }

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", reviewSettings: { gbpLocationName: { not: null } } },
    select: {
      name: true,
      reviewSettings: { select: { gbpLocationName: true } },
    },
    orderBy: { name: "asc" },
  });

  const results: Array<Record<string, unknown>> = [];
  let updated = 0;

  for (const o of outlets) {
    try {
      const location = o.reviewSettings!.gbpLocationName!;
      const current = await getLocationPhones(location);
      if (current.primaryPhone === number) {
        results.push({ outlet: o.name, status: "ok", current: current.primaryPhone });
        continue;
      }
      if (apply) {
        await updateLocationPhone(location, number, current.additionalPhones);
        updated++;
      }
      results.push({
        outlet: o.name,
        status: apply ? "changed" : "would_change",
        current: current.primaryPhone,
        new: number,
        ...(current.additionalPhones.length ? { additionalKept: current.additionalPhones } : {}),
      });
    } catch (e) {
      results.push({ outlet: o.name, status: "error", error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, mode: apply ? "apply" : "dry_run", number, updated, results });
}
