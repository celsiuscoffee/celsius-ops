/**
 * Wrap a sync operation with ads_sync_log bookkeeping.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";

type SyncKind = "accounts" | "campaigns" | "metrics-daily" | "metrics-backfill" | "invoices" | "keywords";

type SyncResult = { rowsInserted?: number; rowsUpdated?: number; metadata?: Prisma.InputJsonValue };

export async function runSync(
  kind: SyncKind,
  accountId: string | null,
  fn: () => Promise<SyncResult>,
): Promise<{ logId: string; result: SyncResult | null; error: string | null }> {
  const logId = randomUUID();

  await prisma.adsSyncLog.create({
    data: {
      id: logId,
      kind,
      accountId,
      status: "RUNNING",
    },
  });

  try {
    const result = await fn();
    await prisma.adsSyncLog.update({
      where: { id: logId },
      data: {
        status: "OK",
        finishedAt: new Date(),
        rowsInserted: result.rowsInserted,
        rowsUpdated: result.rowsUpdated,
        metadata: result.metadata ?? undefined,
      },
    });
    return { logId, result, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.adsSyncLog.update({
      where: { id: logId },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 2000),
      },
    });
    return { logId, result: null, error: message };
  }
}
