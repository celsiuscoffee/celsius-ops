import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { categoryForKeyword } from "@/lib/geogrid/relevance";
import {
  getLocationCategories,
  searchCategoryByName,
  updateLocationCategories,
  type GbpCategoryRef,
} from "@/lib/reviews/gbp";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// GBP allows 1 primary + 9 additional categories per location.
const MAX_ADDITIONAL = 9;

// GET /api/reviews/gbp-categories[?apply=1] — close the relevance gap the
// geogrid keeps measuring: for each connected outlet, derive the categories its
// ACTIVE tracked keywords imply (categoryForKeyword — the same mapping the
// relevance audit uses, so "restaurants near me" implies the Restaurant
// category, "breakfast near me" implies Breakfast restaurant, …) and diff them
// against the live profile. Dry-run by default; ?apply=1 APPENDS the missing
// categories. Append-only by design: the primary category and every category a
// human set by hand are always preserved — this can widen a profile's
// relevance, never narrow it.
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

  const outlets = await prisma.outlet.findMany({
    where: { status: "ACTIVE", reviewSettings: { gbpLocationName: { not: null } } },
    select: {
      id: true,
      name: true,
      reviewSettings: { select: { gbpLocationName: true } },
      geoGridKeywords: { where: { active: true }, select: { keyword: true } },
    },
  });

  // Resolve each wanted display name to its stable category id once per run.
  const refCache = new Map<string, GbpCategoryRef | null>();
  const resolve = async (displayName: string) => {
    if (!refCache.has(displayName)) refCache.set(displayName, await searchCategoryByName(displayName));
    return refCache.get(displayName)!;
  };

  const results: Array<Record<string, unknown>> = [];
  let updated = 0;

  for (const o of outlets) {
    try {
      const wantedNames = [
        ...new Set(o.geoGridKeywords.map((k) => categoryForKeyword(k.keyword)).filter((c): c is string => !!c)),
      ];
      const current = await getLocationCategories(o.reviewSettings!.gbpLocationName!);
      if (!current.primary) {
        results.push({ outlet: o.name, status: "error", error: "profile has no primary category" });
        continue;
      }
      const held = new Set(
        [current.primary, ...current.additional].map((c) => c.displayName.toLowerCase()),
      );

      const missing: GbpCategoryRef[] = [];
      const unresolved: string[] = [];
      for (const name of wantedNames) {
        if (held.has(name.toLowerCase())) continue;
        const ref = await resolve(name);
        if (!ref) unresolved.push(name);
        else if (!held.has(ref.displayName.toLowerCase())) missing.push(ref);
      }

      if (missing.length === 0) {
        results.push({ outlet: o.name, status: "ok", held: [...held], ...(unresolved.length ? { unresolved } : {}) });
        continue;
      }

      const room = MAX_ADDITIONAL - current.additional.length;
      const toAdd = missing.slice(0, Math.max(0, room));
      const skippedForRoom = missing.slice(Math.max(0, room)).map((c) => c.displayName);

      if (apply && toAdd.length > 0) {
        await updateLocationCategories(o.reviewSettings!.gbpLocationName!, current.primary, [
          ...current.additional,
          ...toAdd,
        ]);
        updated++;
      }

      results.push({
        outlet: o.name,
        status: apply && toAdd.length > 0 ? "updated" : "missing",
        primary: current.primary.displayName,
        existingAdditional: current.additional.map((c) => c.displayName),
        adds: toAdd.map((c) => c.displayName),
        ...(skippedForRoom.length ? { skippedNoRoom: skippedForRoom } : {}),
        ...(unresolved.length ? { unresolved } : {}),
      });
    } catch (e) {
      results.push({ outlet: o.name, status: "error", error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, mode: apply ? "apply" : "dry_run", updated, results });
}
