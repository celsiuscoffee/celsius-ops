// Recognise StockAdjustment rows written by the consumption engine so waste
// reports can exclude them. The engine posts USED_NOT_RECORDED rows whose
// `reason` is `reasonMarker(date)` ("auto-consumption:YYYY-MM-DD"). Pure
// (type-only Prisma import).
import type { Prisma } from "@celsius/db";
import { reasonMarker } from "./consumption";

export const CONSUMPTION_REASON_PREFIX = reasonMarker("");

export function isConsumptionEngineReason(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.startsWith(CONSUMPTION_REASON_PREFIX);
}

/**
 * Prisma `where` fragment that keeps only NON-engine adjustments. Written as an
 * explicit OR so rows with a NULL reason are kept (a bare NOT/startsWith would
 * drop them under SQL three-valued logic).
 */
export const NOT_CONSUMPTION_ENGINE_WHERE: { OR: Prisma.StockAdjustmentWhereInput[] } = {
  OR: [{ reason: null }, { NOT: { reason: { startsWith: CONSUMPTION_REASON_PREFIX } } }],
};
