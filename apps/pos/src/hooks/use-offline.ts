/**
 * useOffline — React hook for offline status + pending order count.
 *
 * Shows network status indicator and triggers sync when back online.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  isOnline,
  onNetworkChange,
  getPendingCount,
  syncPendingOrders,
} from "@/lib/offline-queue";

export function useOffline(
  syncFn?: (
    order: Record<string, unknown>,
    items: Record<string, unknown>[],
    payment: Record<string, unknown>,
  ) => Promise<void>,
) {
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Initialize online status (client-side only)
  useEffect(() => {
    setOnline(isOnline());
  }, []);

  // Listen for network changes
  useEffect(() => {
    const cleanup = onNetworkChange((status) => {
      setOnline(status);
      if (status && syncFn) {
        // Auto-sync when back online
        triggerSync();
      }
    });
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFn]);

  // Poll pending count every 5s
  useEffect(() => {
    const check = async () => {
      try {
        const count = await getPendingCount();
        setPendingCount(count);
      } catch {
        // IndexedDB not available
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerSync = useCallback(async () => {
    if (!syncFn || syncing) return;
    setSyncing(true);
    try {
      const result = await syncPendingOrders(syncFn);
      const count = await getPendingCount();
      setPendingCount(count);
      return result;
    } finally {
      setSyncing(false);
    }
  }, [syncFn, syncing]);

  return { online, pendingCount, syncing, triggerSync };
}
