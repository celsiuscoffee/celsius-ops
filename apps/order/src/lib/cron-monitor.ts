// Cron observability wrapper — auth + Sentry in one call per route
// (docs/monitoring-setup.md). Two tiers:
//
//  - heartbeat: pass `monitor` with the crontab from this app's
//    vercel.json. Sentry upserts the Cron Monitor on first check-in and
//    alerts on missed windows, overruns, and thrown errors. Reserved for
//    crons where a silent no-run costs money — Sentry bills per monitor.
//  - error-capture (default, no `monitor`): thrown errors reach Sentry
//    tagged `cron:<slug>` instead of dying in Vercel logs. A cron that
//    stops being invoked at all is NOT detected in this tier.
//
// Identical copies live in backoffice/order/staff: @celsius/shared is
// deliberately free of @sentry/* imports (see sentry-scrub.ts) and the
// pickup app has no Sentry dependency to satisfy a barrel re-export.

import * as Sentry from "@sentry/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@celsius/shared";

export type CronMonitorConfig = {
  /** Crontab (UTC) — MUST match this cron's schedule in vercel.json. */
  schedule: string;
  /** Minutes past the scheduled time before the run counts as missed. */
  checkinMargin?: number;
  /** Minutes a run may take before it counts as failed. */
  maxRuntime?: number;
};

export function cronRoute(
  slug: string,
  handler: (req: NextRequest) => Promise<Response>,
  monitor?: CronMonitorConfig,
): (req: NextRequest) => Promise<Response> {
  return async (req) => {
    const auth = checkCronAuth(req.headers);
    if (!auth.ok) {
      // No check-in on auth failure: scanners must not feed the monitor,
      // and a misconfigured CRON_SECRET should surface as a missed
      // window, not a healthy run.
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    try {
      if (monitor) {
        return await Sentry.withMonitor(slug, () => handler(req), {
          schedule: { type: "crontab", value: monitor.schedule },
          checkinMargin: monitor.checkinMargin ?? 5,
          maxRuntime: monitor.maxRuntime ?? 10,
          timezone: "Etc/UTC", // vercel.json crontabs are UTC
        });
      }
      return await handler(req);
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: slug } });
      // Flush before the serverless function freezes — without it the
      // event can sit in the buffer and never send.
      await Sentry.flush(2000);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : `${slug} failed` },
        { status: 500 },
      );
    }
  };
}
