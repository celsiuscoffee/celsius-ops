"use client";

// Per-route-segment error boundary. Reports to Sentry then shows a
// friendly retry UI. Works in concert with global-error.tsx for
// errors that escape the root layout.

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-text">Something went wrong</h2>
      <p className="max-w-md text-sm text-text-2">
        We hit an unexpected error and our team has been notified. You can try again or come back in a moment.
      </p>
      {error.digest && (
        <p className="text-[11px] text-text-3">Reference: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-on-ink hover:bg-ink"
      >
        Try again
      </button>
    </div>
  );
}
