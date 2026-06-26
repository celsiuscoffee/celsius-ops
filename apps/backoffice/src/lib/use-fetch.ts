"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
});

export type UseFetchOptions = {
  /** Poll the URL on this interval (ms). Omit/0 = no polling. */
  refreshInterval?: number;
  /** Dedup window (ms). Defaults to 10s; lower it when polling fast. */
  dedupingInterval?: number;
  /** Revalidate when the tab regains focus (good for live inboxes). */
  revalidateOnFocus?: boolean;
};

/**
 * Cached data fetcher using SWR.
 * - Returns cached data instantly on re-render / page navigation
 * - Revalidates in background (stale-while-revalidate)
 * - Deduplicates concurrent requests to the same URL
 * - Optional polling (`refreshInterval`) for near-real-time views (chat inbox).
 */
export function useFetch<T = unknown>(url: string | null, opts: UseFetchOptions = {}) {
  // When polling, the dedup window must not exceed the poll interval or
  // scheduled refreshes get swallowed; default to just under the interval.
  const dedupingInterval =
    opts.dedupingInterval ??
    (opts.refreshInterval ? Math.max(1000, Math.floor(opts.refreshInterval * 0.6)) : 10000);

  const { data, error, isLoading, mutate } = useSWR<T>(url, fetcher, {
    revalidateOnFocus: opts.revalidateOnFocus ?? false,
    dedupingInterval,
    refreshInterval: opts.refreshInterval ?? 0,
  });

  return { data: data as T | undefined, error, isLoading, mutate };
}
