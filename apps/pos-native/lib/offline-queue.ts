// Durable local buffer of completed sales that haven't been confirmed to the
// cloud yet. The till is ONLINE-FIRST: when connected the buffer is empty
// within ~1s of each sale (the sync pushes immediately). It only fills during
// an internet outage, and drains automatically on reconnect.
//
// Each entry is an immutable, completed sale keyed by a client-generated UUID,
// so re-uploading via the idempotent create_pos_sale RPC is always safe.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "pos.offline.sales.v1";
// Dead-letter: sales the server keeps rejecting (not a network failure). Moved
// here after a few attempts so a single bad sale can't jam the live queue. Kept
// for inspection/manual recovery rather than dropped.
const DEAD_KEY = "pos.offline.deadletter.v1";

export type SalePayload = {
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  payments: Record<string, unknown>[];
};

export type PendingSale = {
  payload: SalePayload;
  /** Deferred loyalty completion — fired AFTER the order confirms to the cloud
   *  (idempotent server-side). Null for guest sales. */
  loyalty: { memberId: string; orderId: string } | null;
  bufferedAt: string;
  attempts: number;
};

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let cachedCount = 0;

export function subscribePending(l: Listener): () => void {
  listeners.add(l);
  try {
    l(cachedCount);
  } catch {
    /* ignore */
  }
  return () => listeners.delete(l);
}

function emit(n: number): void {
  cachedCount = n;
  for (const l of listeners) {
    try {
      l(n);
    } catch {
      /* ignore */
    }
  }
}

function orderIdOf(e: PendingSale): string | undefined {
  return (e.payload.order as { id?: string }).id;
}

async function readAll(): Promise<PendingSale[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingSale[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(list: PendingSale[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  emit(list.length);
}

/** Append a completed sale to the buffer. Deduped by order id so the same sale
 *  is never queued twice. */
export async function bufferSale(entry: PendingSale): Promise<void> {
  const list = await readAll();
  const id = orderIdOf(entry);
  if (id && list.some((e) => orderIdOf(e) === id)) return;
  list.push(entry);
  await writeAll(list);
}

export async function listPending(): Promise<PendingSale[]> {
  const list = await readAll();
  emit(list.length);
  return list;
}

export async function removePending(orderId: string): Promise<void> {
  const list = await readAll();
  const next = list.filter((e) => orderIdOf(e) !== orderId);
  if (next.length !== list.length) await writeAll(next);
}

export async function bumpAttempts(orderId: string): Promise<void> {
  const list = await readAll();
  let changed = false;
  for (const e of list) {
    if (orderIdOf(e) === orderId) {
      e.attempts = (e.attempts ?? 0) + 1;
      changed = true;
    }
  }
  if (changed) await writeAll(list);
}

/** Move a sale the server keeps REJECTING (not a network failure) out of the
 *  live queue into a dead-letter, so it can't block the sales behind it. The
 *  payload is preserved for inspection/manual recovery — never silently dropped.
 *  (With the hardened server RPC this should effectively never fire.) */
export async function quarantine(orderId: string): Promise<void> {
  const list = await readAll();
  const entry = list.find((e) => orderIdOf(e) === orderId);
  if (!entry) return;
  try {
    const raw = await AsyncStorage.getItem(DEAD_KEY);
    const dead = raw ? (JSON.parse(raw) as PendingSale[]) : [];
    if (!dead.some((e) => orderIdOf(e) === orderId)) {
      dead.push(entry);
      await AsyncStorage.setItem(DEAD_KEY, JSON.stringify(dead));
    }
  } catch {
    /* if the dead-letter write fails we still unblock the queue below */
  }
  await removePending(orderId);
}

/** Dead-lettered sales (server-rejected, quarantined). For diagnostics/recovery. */
export async function listDeadLetter(): Promise<PendingSale[]> {
  try {
    const raw = await AsyncStorage.getItem(DEAD_KEY);
    return raw ? (JSON.parse(raw) as PendingSale[]) : [];
  } catch {
    return [];
  }
}

// One-shot recovery of sales dead-lettered by the 2026-10-03 create_pos_sale
// outage (an order-number renumber loop timed out every upload from Putrajaya).
// The server is fixed (migration 111), so every held sale can now land. This
// moves each dead-lettered sale back into the live queue with a fresh attempt
// count, ONCE per till (flag below). Safe on every till:
//   - create_pos_sale is idempotent on order id, so a sale that already reached
//     the cloud is a no-op, never a duplicate;
//   - a sale the server still rejects simply returns to the dead-letter after
//     the usual attempts;
//   - the dead-letter copy is kept, so nothing is ever deleted by this step.
// The sale keeps its original created_at and shift, so it lands on the day it
// was rung up. The server assigns a fresh order number on collision.
const REQUEUE_FLAG = "pos.offline.deadletter.requeued.2026-10-04";

export async function requeueDeadLetterOnce(): Promise<number> {
  try {
    if (await AsyncStorage.getItem(REQUEUE_FLAG)) return 0;
    const dead = await listDeadLetter();
    let moved = 0;
    if (dead.length > 0) {
      const list = await readAll();
      const queued = new Set(list.map(orderIdOf).filter(Boolean));
      for (const e of dead) {
        const id = orderIdOf(e);
        if (!id || queued.has(id)) continue;
        list.push({ ...e, attempts: 0 });
        queued.add(id);
        moved += 1;
      }
      if (moved > 0) await writeAll(list);
    }
    await AsyncStorage.setItem(REQUEUE_FLAG, new Date().toISOString());
    return moved;
  } catch {
    // Storage hiccup: leave the flag unset so the next launch tries again.
    return 0;
  }
}

export async function pendingCount(): Promise<number> {
  const n = (await readAll()).length;
  emit(n);
  return n;
}

/** UUID v4 (Math.random-based). Used as the sale's idempotency key — uniqueness
 *  is all that matters here, not cryptographic strength. */
export function newId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
