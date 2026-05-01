"use client";

// Root-level error boundary — fires when an error escapes the root
// layout (e.g. layout itself throws). Must render its own <html> +
// <body> because the normal layout has crashed.

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
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
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24, textAlign: "center", fontFamily: "system-ui, -apple-system, sans-serif" }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>Something went wrong</h2>
          <p style={{ maxWidth: 480, fontSize: 14, color: "#555", marginBottom: 16 }}>
            A critical error occurred. Our team has been notified. Please try refreshing the page.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, color: "#999", marginBottom: 12 }}>Reference: {error.digest}</p>
          )}
          <button
            onClick={reset}
            style={{ padding: "8px 16px", borderRadius: 6, background: "#111", color: "#fff", border: "none", fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
