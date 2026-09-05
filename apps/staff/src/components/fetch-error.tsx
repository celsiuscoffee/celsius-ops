"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

// Inline failure card for useFetch consumers. Every HR page used to render its
// empty state on a failed fetch ("No attendance records", "No payslips yet"),
// so a 401 after the PIN session expired, or a 500, looked like the person
// simply had no data. Session expiry is the common case: say so and offer the
// login page rather than a retry that will fail the same way.
export function FetchError({
  error,
  onRetry,
  what = "this page",
}: {
  error: unknown;
  onRetry?: () => void;
  what?: string;
}) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const unauthorized = /\b401\b/.test(message);
  return (
    <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-5 text-center">
      <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-400" />
      <p className="text-sm font-semibold text-red-700">
        {unauthorized ? "Your session has expired" : `Couldn't load ${what}`}
      </p>
      <p className="mt-0.5 text-xs text-red-600">
        {unauthorized
          ? "Sign in again to continue."
          : "Check your connection and try again. If it keeps happening, tell your manager."}
      </p>
      {unauthorized ? (
        <a
          href="/login"
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white"
        >
          Sign in
        </a>
      ) : onRetry ? (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 active:scale-95"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      ) : null}
    </div>
  );
}
