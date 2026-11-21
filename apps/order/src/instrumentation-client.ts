// Sentry client-side initialization. Imported automatically by Next.js
// at the start of every browser bundle. Captures unhandled exceptions,
// React rendering errors (when paired with error.tsx / global-error.tsx),
// and provides Sentry.captureException() to call sites.
//
// SENTRY_DSN comes from env. When unset (local dev) Sentry is a no-op
// so we don't pay the bundle / network cost during development.

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Sample 10% of traces in prod, 100% in dev for a clearer picture.
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    // Capture replays for 10% of sessions and 100% of error sessions.
    replaysSessionSampleRate: 0.0,
    replaysOnErrorSampleRate: process.env.NODE_ENV === "production" ? 1.0 : 0.0,
    // The default integrations cover global error / unhandled rejection.
    //
    // Crypto-wallet browser extensions (MetaMask and friends) inject
    // window.ethereum into every page and throw inside their own injected
    // script on sites that never touch it. One wallet-carrying visitor
    // opened a separate Sentry issue per route (CELSIUS-OPS-9N et al.),
    // so drop anything referencing the injected object — none of our code
    // reads window.ethereum.
    ignoreErrors: [/window\.ethereum/],
  });
}

// Required for Next.js navigation transactions to be captured.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
