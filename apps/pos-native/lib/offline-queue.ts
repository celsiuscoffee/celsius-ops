// Durable local buffer of completed sales that haven't been confirmed to the
// cloud yet. The till is ONLINE-FIRST: when connected the buffer is empty
// within ~1s of each sale (the sync pushes immediately). It only fills during
// an internet outage, and drains automatically on reconnect.
//
// Each entry is an immutable, completed sale keyed by a client-generated UUID,
// so re-uploading via the idempotent create_pos_sale RPC is always safe.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "pos.offline.sales.v1";

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
