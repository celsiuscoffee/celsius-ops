/**
 * Offline Order Queue — IndexedDB-based order queue for offline POS operation.
 *
 * When the network is down, orders are saved to IndexedDB.
 * When connectivity returns, queued orders are synced to Supabase.
 */

const DB_NAME = "celsius-pos-offline";
const DB_VERSION = 1;
const STORE_NAME = "pending_orders";

// ─── IndexedDB Setup ─────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("created_at", "created_at");
        store.createIndex("synced", "synced");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Queue Operations ────────────────────────────────────────────────────────

export interface OfflineOrder {
  id?: number;
  order: Record<string, unknown>;
  items: Record<string, unknown>[];
  payment: Record<string, unknown>;
  created_at: string;
  synced: boolean;
  sync_error?: string;
}

/**
 * Save an order to the offline queue.
 */
export async function queueOrder(
  order: Record<string, unknown>,
  items: Record<string, unknown>[],
  payment: Record<string, unknown>,
): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const entry: OfflineOrder = {
      order,
      items,
      payment,
      created_at: new Date().toISOString(),
      synced: false,
    };
    const request = store.add(entry);
    request.onsuccess = () => resolve(request.result as number);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending (unsynced) orders.
 */
export async function getPendingOrders(): Promise<OfflineOrder[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("synced");
    const request = index.getAll(IDBKeyRange.only(false));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Mark an order as synced.
 */
export async function markSynced(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result;
      if (entry) {
        entry.synced = true;
        store.put(entry);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Mark an order sync as failed with error message.
 */
export async function markSyncFailed(id: number, error: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result;
      if (entry) {
        entry.sync_error = error;
        store.put(entry);
      }
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Get count of pending orders.
 */
export async function getPendingCount(): Promise<number> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("synced");
    const request = index.count(IDBKeyRange.only(false));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all synced orders (cleanup).
 */
export async function clearSyncedOrders(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("synced");
    const request = index.openCursor(IDBKeyRange.only(true));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// ─── Sync Engine ─────────────────────────────────────────────────────────────

type SyncFn = (
  order: Record<string, unknown>,
  items: Record<string, unknown>[],
  payment: Record<string, unknown>,
) => Promise<void>;

let syncInProgress = false;

/**
 * Sync all pending orders to the server.
 * Pass a function that creates the order in Supabase.
 */
export async function syncPendingOrders(createOrderFn: SyncFn): Promise<{
  synced: number;
  failed: number;
}> {
  if (syncInProgress) return { synced: 0, failed: 0 };
  syncInProgress = true;

  let synced = 0;
  let failed = 0;

  try {
    const pending = await getPendingOrders();
    for (const entry of pending) {
      try {
        await createOrderFn(entry.order, entry.items, entry.payment);
        await markSynced(entry.id!);
        synced++;
      } catch (err) {
        await markSyncFailed(entry.id!, err instanceof Error ? err.message : "Unknown error");
        failed++;
      }
    }
  } finally {
    syncInProgress = false;
  }

  // Clean up synced orders
  if (synced > 0) {
    await clearSyncedOrders();
  }

  return { synced, failed };
}

// ─── Network Status Hook ─────────────────────────────────────────────────────

/**
 * Check if the browser is online.
 */
export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

/**
 * Register online/offline event listeners.
 * Returns a cleanup function.
 */
export function onNetworkChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}
