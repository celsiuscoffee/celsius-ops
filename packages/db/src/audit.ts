/**
 * Audit logging helpers backed by the ActivityLog table.
 *
 * Two entry points:
 *   - logActivity(params)       — bare insert, fire-and-forget
 *   - audited(opts, fn)         — wrap a mutation; audit row is written
 *                                 after the mutation resolves
 *
 * Failures to write the audit row are swallowed (logged to console).
 * Never let audit-logging failure block a business operation.
 */
import { prisma } from "./index";

export type ActivityLogParams = {
  userId?: string | null;
  action: string;
  module: string;
  details?: string;
  targetId?: string;
  targetName?: string;
  diff?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
};

export async function logActivity(params: ActivityLogParams): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        module: params.module,
        details: params.details,
        targetId: params.targetId,
        targetName: params.targetName,
        diff: params.diff ?? undefined,
        metadata: params.metadata ?? undefined,
        ipAddress: params.ipAddress,
      },
    });
  } catch (err) {
    console.error("[audit] logActivity failed", { action: params.action, err });
  }
}

export type AuditOptions = {
  actorId: string | null;
  action: string;
  module: string;
  target?: { id: string; name?: string };
  diff?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
};

/**
 * Wrap a mutation so an ActivityLog row is written after it resolves.
 * Returns the mutation's return value unchanged.
 *
 *   const invoice = await audited(
 *     { actorId: session.id, action: "INVOICE_MARK_PAID", module: "invoices",
 *       target: { id: invoiceId }, metadata: { source: "telegram" } },
 *     () => prisma.invoice.update({ where: { id: invoiceId }, data: { status: "PAID" } }),
 *   );
 */
export async function audited<T>(opts: AuditOptions, fn: () => Promise<T>): Promise<T> {
  const result = await fn();
  void logActivity({
    userId: opts.actorId,
    action: opts.action,
    module: opts.module,
    targetId: opts.target?.id,
    targetName: opts.target?.name,
    diff: opts.diff,
    metadata: opts.metadata,
    ipAddress: opts.ipAddress,
  });
  return result;
}
