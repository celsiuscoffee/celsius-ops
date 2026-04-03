"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
});

/**
 * Cached data fetcher using SWR.
 * - Returns cached data instantly on re-render / page navigation
 * - Revalidates in background (stale-while-revalidate)
 * - Deduplicates concurrent requests to the same URL
 */
export function useFetch<T = unknown>(url: string | null) {
  const { data, error, isLoading, mutate } = useSWR<T>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 10000, // don't re-fetch same URL within 10s
  });

  return { data: data as T | undefined, error, isLoading, mutate };
}
