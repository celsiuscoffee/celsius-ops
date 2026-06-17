import { apiGet, apiPost } from "./api";

/**
 * GrabFood store pause/resume for THIS outlet, via the per-outlet POS endpoint
 * /api/pos/grab/store-control (resolves the outlet's grab_merchant_id + calls
 * Grab's pauseStore / getStoreStatus). Mirrors lib/ordering.ts.
 *
 * `configured` is false when the outlet isn't on GrabFood (no merchant id) or
 * Grab creds aren't live — the Settings screen hides the card in that case.
 */

export async function getGrabStore(
  outletId: string,
): Promise<{ configured: boolean; paused: boolean }> {
  const r = await apiGet<{ configured?: boolean; paused?: boolean }>(
    `/api/pos/grab/store-control?outlet_id=${encodeURIComponent(outletId)}`,
  );
  return { configured: !!r.configured, paused: !!r.paused };
}

/** Pause (true) or resume (false) the outlet on GrabFood. Returns new paused state. */
export async function setGrabStorePaused(outletId: string, paused: boolean): Promise<boolean> {
  const r = await apiPost<{ ok?: boolean; paused?: boolean; error?: string }>(
    `/api/pos/grab/store-control`,
    { outlet_id: outletId, pause: paused },
  );
  if (!r.ok) throw new Error(r.error || "Couldn't update GrabFood store");
  return !!r.paused;
}
