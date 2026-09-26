// Background sync for buffered sales. Pushes each completed sale to the cloud
// through POST /api/pos/sales (which runs the atomic, idempotent
// create_pos_sale RPC with the service role — the till no longer calls the RPC
// with the anon key, see the route's header), then fires its deferred loyalty
// completion. Runs immediately after every sale (online-first), plus on
// app-foreground and a slow interval so an outage drains on reconnect.

import { AppState } from "react-native";
import { apiPostResult } from "./api";
import { posOrderComplete } from "./loyalty";
import { listPending, removePending, bumpAttempts, quarantine, type PendingSale } from "./offline-queue";
import { markOnline, markOffline } from "./connectivity";

let flushing = false;
let started = false;

// After this many SERVER rejections (not network failures), a sale is
// dead-lettered so it can't keep the queue from draining. Network outages don't
// count toward this — they retry indefinitely on reconnect.
const MAX_SYNC_ATTEMPTS = 5;

function orderIdOf(e: PendingSale): string | undefined {
  return (e.payload.order as { id?: string }).id;
}

/** The outcome of trying to sync one buffered sale:
 *  - "ok":       it's in the cloud now (or already was) → removed from the queue
 *  - "network":  the call didn't reach the server → we're offline, retry later
 *  - "retry":    the server answered but not about THIS sale (no/expired POS
 *                session → 401, or a 5xx) → stop the drain, retry later, and
 *                never count it toward dead-lettering
 *  - "rejected": the server rejected the payload (400/422) → don't let it
 *                block the rest of the queue. */
type SyncResult = "ok" | "network" | "retry" | "rejected";

async function syncOne(entry: PendingSale): Promise<SyncResult> {
  const orderId = orderIdOf(entry);
  if (!orderId) return "ok"; // malformed → treat as done so it's skipped

  let res: Awaited<ReturnType<typeof apiPostResult<unknown>>>;
  try {
    // doFetch has its own 8s timeout and drives the online/offline flag.
    res = await apiPostResult("/api/pos/sales", entry.payload);
  } catch {
    // Transport failure / timeout → the call never landed. We're offline; leave
    // the sale buffered and stop the drain so it retries on the next tick.
    markOffline();
    return "network";
  }

  // The server answered, so we're online. Only a 4xx that is about this
  // payload (400 malformed, 422 DB rejected) is a per-sale problem; an auth
  // failure or server error must not burn the sale's attempts.
  markOnline();
  if (!res.ok) {
    if (res.status === 400 || res.status === 422) return "rejected";
    return "retry";
  }

  // The order is now durably in pos_orders → fire the deferred loyalty
  // earn/burn + tier re-eval + mystery drop. Server-idempotent (keyed on the
  // order), so a retry can't double-credit.
  if (entry.loyalty?.memberId) {
    try {
      await posOrderComplete(entry.loyalty.memberId, entry.loyalty.orderId);
    } catch {
      /* non-critical: /complete is idempotent; a transient miss reconciles on
         a later flush if it ever matters. Don't block clearing the sale. */
    }
  }

  await removePending(orderId);
  return "ok";
}

/** Drain the buffer. Stops at the first NETWORK or auth/server failure and
 *  retries on the next tick. A server-REJECTED sale is skipped (and
 *  dead-lettered after a few tries) so it can never jam the sales behind it.
 *  Re-entrancy-guarded. */
export async function flushPending(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const list = await listPending();
    for (const entry of list) {
      const r = await syncOne(entry);
      if (r === "network" || r === "retry") break; // offline / not signed in → stop; the rest will also fail
      if (r === "rejected") {
        const id = orderIdOf(entry);
        if (id) {
          await bumpAttempts(id);
          if ((entry.attempts ?? 0) + 1 >= MAX_SYNC_ATTEMPTS) {
            await quarantine(id); // dead-letter so it stops blocking the queue
          }
        }
        continue; // keep draining the sales behind it
      }
      // "ok" → already removed from the queue; keep going
    }
  } finally {
    flushing = false;
  }
}

/** Start the background drain: once now, on every app-foreground, and every
 *  20s as a backstop. Idempotent — safe to call from multiple mounts. */
export function startSyncLoop(): void {
  if (started) return;
  started = true;
  void flushPending();
  setInterval(() => {
    void flushPending();
  }, 20000);
  AppState.addEventListener("change", (s) => {
    if (s === "active") void flushPending();
  });
}
