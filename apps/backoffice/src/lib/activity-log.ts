// Activity log helper. Centralised so every audit-worthy action — staff
// creation, permission flips, deactivation, role changes — gets recorded in
// one shape with an actor + before/after diff. Backed by the existing
// ActivityLog table in Postgres (id, userId, action, module, details,
// targetId, targetName, ipAddress, createdAt).
//
// Best-effort: failures here MUST NOT take down the calling endpoint, so we
// catch + log instead of throwing. The audit trail is for accountability,
// not blocking writes.

import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import type { NextRequest } from "next/server";

type Diff = Record<string, { from: unknown; to: unknown }>;

export async function logActivity(args: {
  actorId: string;
  action: string;
  module: string;
  targetId?: string | null;
  targetName?: string | null;
  details?: Record<string, unknown> | null;
  request?: NextRequest;
}) {
  try {
    const ip = args.request
      ? args.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        args.request.headers.get("x-real-ip") ||
        null
      : null;
    await prisma.activityLog.create({
      data: {
        id: randomUUID(),
        userId: args.actorId,
        action: args.action,
        module: args.module,
        // Schema column is TEXT, not JSONB — stringify so it round-trips
        // through JSON.parse() on read.
        details: args.details ? JSON.stringify(args.details) : null,
        targetId: args.targetId ?? null,
        targetName: args.targetName ?? null,
        ipAddress: ip,
      },
    });
  } catch (err) {
    console.error("[activity-log] failed:", err);
  }
}

/**
 * Compute a diff between old and new field maps. Only includes keys whose
 * value actually changed. Treats arrays as sets-of-strings for stable
 * comparison (so reordering ["ops","loyalty"] vs ["loyalty","ops"] is a
 * no-op, not a fake change).
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Diff {
  const diff: Diff = {};
  for (const k of fields) {
    if (!(k in after)) continue;
    const a = before[k];
    const b = after[k];
    if (Array.isArray(a) && Array.isArray(b)) {
      const aSorted = [...a].map(String).sort();
      const bSorted = [...b].map(String).sort();
      if (aSorted.join("|") !== bSorted.join("|")) diff[k] = { from: a, to: b };
      continue;
    }
    if (typeof a === "object" || typeof b === "object") {
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) diff[k] = { from: a, to: b };
      continue;
    }
    if (a !== b) diff[k] = { from: a, to: b };
  }
  return diff;
}
