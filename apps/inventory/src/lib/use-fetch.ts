"use client";

import useSWR, { type SWRConfiguration } from "swr";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
});

const defaultOpts: SWRConfiguration = {
  revalidateOnFocus: false,
  dedupingInterval: 30_000,    // don't re-fetch same URL within 30s
  revalidateIfStale: false,    // serve cache until explicit mutate
  keepPreviousData: true,      // keep stale data visible during revalidation
};

/**
 * Cached data fetcher using SWR.
 * - Returns cached data instantly on re-render / page navigation
 * - Revalidates in background (stale-while-revalidate)
 * - Deduplicates concurrent requests to the same URL
 * - keepPreviousData prevents flash of empty state on URL changes (e.g. pagination)
 */
export function useFetch<T = unknown>(url: string | null, opts?: SWRConfiguration) {
  const { data, error, isLoading, mutate } = useSWR<T>(url, fetcher, {
    ...defaultOpts,
    ...opts,
  });

  return { data: data as T | undefined, error, isLoading, mutate };
}
