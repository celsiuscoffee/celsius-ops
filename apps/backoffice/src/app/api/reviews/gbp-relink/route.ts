import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listAccountLocations } from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/reviews/gbp-relink[?apply=1] — audit (and with apply=1, repair) each
// outlet's gbpLocationName against the GBP account's own location list, matched
// by Places id. Exists because a location name can be mis-set by hand (found
// live: Tamarind carried Shah Alam's locations/… id, so its review snapshots,
// review feed and relevance audit all read the wrong shop). The Places id is
// the outlet's verified public identity (matches its geogrid scans and review
// QR), so the account listing whose metadata.placeId equals it IS this outlet.
// Dry-run by default; nothing outside ReviewSettings.gbpLocationName is ever
// touched, and only for outlets where the stored value provably mismatches.
export async function GET(request: NextRequest) {
  const cronAuth = checkCronAuth(request.headers);
  if (!cronAuth.ok) {
    try {
      await requireRole(request.headers, "ADMIN");
    } catch {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const apply = new URL(request.url).searchParams.get("apply") === "1";

  const settings = await prisma.reviewSettings.findMany({
    where: {
      gbpAccountId: { not: null },
      gbpPlaceId: { not: null },
      outlet: { status: "ACTIVE" },
    },
    include: { outlet: { select: { name: true } } },
  });
  if (settings.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, note: "No outlets with gbpAccountId + gbpPlaceId" });
  }

  // One listing call per distinct account (they all share the MCC-style account).
  const byAccount = new Map<string, Awaited<ReturnType<typeof listAccountLocations>>>();
  const results: Array<Record<string, unknown>> = [];
  let repaired = 0;

  for (const s of settings) {
    try {
      let locations = byAccount.get(s.gbpAccountId!);
      if (!locations) {
        locations = await listAccountLocations(s.gbpAccountId!);
        byAccount.set(s.gbpAccountId!, locations);
      }
      const match = locations.find((l) => l.placeId === s.gbpPlaceId);
      if (!match) {
        results.push({ outlet: s.outlet.name, status: "no_match", placeId: s.gbpPlaceId });
        continue;
      }
      if (match.name === s.gbpLocationName) {
        results.push({ outlet: s.outlet.name, status: "ok", location: match.name });
        continue;
      }
      if (apply) {
        await prisma.reviewSettings.update({
          where: { outletId: s.outletId },
          data: { gbpLocationName: match.name },
        });
        repaired++;
      }
      results.push({
        outlet: s.outlet.name,
        status: apply ? "repaired" : "mismatch",
        stored: s.gbpLocationName,
        correct: match.name,
        gbpTitle: match.title,
      });
    } catch (e) {
      results.push({ outlet: s.outlet.name, status: "error", error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, mode: apply ? "apply" : "dry_run", checked: settings.length, repaired, results });
}
