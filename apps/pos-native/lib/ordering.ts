/**
 * Online-ordering open/close for THIS outlet — the "stop taking QR table +
 * pickup orders" switch exposed in POS Settings. Thin wrapper over the
 * backoffice /api/pos/ordering-open endpoint, which flips the same
 * outlet_settings.is_open flag both order paths (pickup + QR checkout) already
 * guard on. Needs a working connection: it changes the cloud flag so customers
 * stop ordering — it can't be done offline.
 */
import { apiGet, apiPost } from "@/lib/api";

/** Current accepting-orders state for an outlet. Defaults to open. */
export async function getOrderingOpen(outletId: string): Promise<boolean> {
  const res = await apiGet<{ is_open?: boolean }>(
    `/api/pos/ordering-open?outlet_id=${encodeURIComponent(outletId)}`,
  );
  return res.is_open !== false;
}

/** Pause (false) or resume (true) online ordering for an outlet. */
export async function setOrderingOpen(outletId: string, isOpen: boolean): Promise<boolean> {
  const res = await apiPost<{ is_open?: boolean }>("/api/pos/ordering-open", {
    outlet_id: outletId,
    is_open: isOpen,
  });
  return res.is_open !== false;
}
