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
    // Google Ads errors: GoogleAdsFailure with .errors[{ error_code, message, location }]
    let message: string;
    const e = err as { errors?: Array<{ error_code?: unknown; message?: string; location?: unknown }>; request_id?: string; message?: string; stack?: string };
    if (e?.errors && Array.isArray(e.errors) && e.errors.length > 0) {
      const parts = e.errors.map((x) => `${x.message ?? "(no message)"} [code=${JSON.stringify(x.error_code ?? {})}]${x.location ? ` loc=${JSON.stringify(x.location)}` : ""}`);
      message = `GoogleAds: ${parts.join(" | ")} (request_id=${e.request_id ?? "?"})`;
    } else if (err instanceof Error) {
      message = err.message + (err.stack ? `\n${err.stack}` : "");
    } else if (err && typeof err === "object") {
      try {
        message = JSON.stringify(err, Object.getOwnPropertyNames(err));
      } catch {
        message = String(err);
      }
    } else {
      message = String(err);
    }
    console.error(`[ads sync ${kind}] failed:`, err);
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
