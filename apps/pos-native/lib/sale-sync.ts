// Background sync for buffered sales. Pushes each completed sale to the cloud
// via the atomic, idempotent create_pos_sale RPC, then fires its deferred
// loyalty completion. Runs immediately after every sale (online-first), plus on
// app-foreground and a slow interval so an outage drains on reconnect.

import { AppState } from "react-native";
import { supabase } from "./supabase";
import { posOrderComplete } from "./loyalty";
import { listPending, removePending, bumpAttempts, type PendingSale } from "./offline-queue";
import { markOnline, markOffline, withTimeout } from "./connectivity";

let flushing = false;
let started = false;

function orderIdOf(e: PendingSale): string | undefined {
  return (e.payload.order as { id?: string }).id;
}

/** Sync one buffered sale. Returns true if it's now in the cloud (or was
 *  already), false if the network failed (leave it buffered, retry later). */
async function syncOne(entry: PendingSale): Promise<boolean> {
  const orderId = orderIdOf(entry);
  if (!orderId) return true; // malformed → drop it

  try {
    const res = await withTimeout(
      Promise.resolve(supabase.rpc("create_pos_sale", { p: entry.payload })),
      8000,
    );
    if ((res as { error?: unknown }).error) throw (res as { error: unknown }).error;
  } catch {
    markOffline();
    void bumpAttempts(orderId);
    return false;
  }

  markOnline();

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
  return true;
}

/** Drain the buffer. Stops at the first network failure (we're offline) and
 *  retries on the next tick. Re-entrancy-guarded. */
export async function flushPending(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const list = await listPending();
    for (const entry of list) {
      const ok = await syncOne(entry);
      if (!ok) break;
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
