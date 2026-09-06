import { prisma } from "@/lib/prisma";
import { verifyPin } from "@celsius/auth";

// PIN logins share ONE namespace: apps/backoffice/api/auth/pin authenticates
// by PIN alone, trying every backoffice-capable user's hash and taking the
// first match, and the staff app's PIN login works the same way per outlet.
// Two people with the same PIN therefore log in as whichever row the query
// returns first. Nothing checked this at set time (2026-09-03 QA), so HR
// could hand a new manager an ADMIN's PIN by accident.

export const PIN_PATTERN = /^\d{6}$/; // the staff app requires exactly 6

/** True when another ACTIVE account already uses this PIN. */
export async function pinInUse(pin: string, excludeUserId?: string): Promise<boolean> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", pin: { not: null }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true, pin: true },
  });
  for (const u of users) {
    if (u.pin && (await verifyPin(pin, u.pin)).match) return true;
  }
  return false;
}
