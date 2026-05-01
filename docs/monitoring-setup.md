# Monitoring & alerting setup

The audit on 2026-04-30 flagged "no uptime monitoring" as a critical gap.
Each app now exposes an `/api/health` endpoint that returns 200 OK with
a tiny payload (status, timestamp, deploy SHA). Pointing a monitoring
service at these URLs takes 5–10 minutes per service.

## What to monitor

### Health endpoints (every 1–5 min)

| App | URL |
|-----|-----|
| Backoffice | https://backoffice.celsiuscoffee.com/api/health |
| Loyalty | https://members.celsiuscoffee.com/api/health (or your loyalty domain) |
| Order | https://order.celsiuscoffee.com/api/health |
| POS | https://pos.celsiuscoffee.com/api/health |
| Staff | https://staff.celsiuscoffee.com/api/health |

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2026-05-01T03:34:31.000Z",
  "sha": "9d6a084",
  "env": "production"
}
```

### Cron heartbeats (per-cron, alert if missing)

The 14 Vercel crons silently fail into logs unless you wire heartbeat
monitoring. **Recommended:** Sentry Cron Monitors (lives next to your
existing Sentry setup, no new account).

| Cron | Schedule | App |
|------|----------|-----|
| /api/cron/attendance-auto-close | Every 15 min | backoffice |
| /api/cron/campaigns-auto | Hourly | backoffice |
| /api/cron/ads-daily | 3 AM MYT | backoffice |
| /api/cron/ads-monthly | 4 AM 2nd of month | backoffice |
| /api/cron/deactivate-resigned | Nightly | backoffice |
| /api/cron/sync-products | Every 6h | loyalty |
| /api/cron/expire-orders | Every 10 min | order |
| /api/cron/reconcile-pending | Every 1 min | order |
| /api/cron/auto-hours | Hourly | order |
| /api/cron/sync-menu | Every 10 min | order |
| /api/cron/reset-checklists | 12am MYT | staff |

## Recommended setup (free / low cost)

### 1. BetterUptime (uptime — free tier 10 monitors)

1. Sign up at https://betterstack.com/uptime
2. Create a monitor for each `/api/health` URL above
3. Set check interval: 1 min for production-critical (order, POS),
   5 min for the rest
4. Alert via email + Slack webhook (or SMS — paid)
5. Add a public status page if you want customers to see uptime

### 2. Sentry Cron Monitors (free with existing Sentry)

In the Sentry UI:
1. Settings → Crons → Create Monitor for each cron above
2. Set schedule (e.g. `*/15 * * * *` for attendance-auto-close)
3. Sentry generates a check-in URL and slug
4. Wrap the cron handler:
   ```ts
   import * as Sentry from "@sentry/nextjs";
   const monitorSlug = "attendance-auto-close";
   const checkInId = Sentry.captureCheckIn({ monitorSlug, status: "in_progress" });
   try {
     // ... existing cron logic ...
     Sentry.captureCheckIn({ checkInId, monitorSlug, status: "ok" });
   } catch (err) {
     Sentry.captureCheckIn({ checkInId, monitorSlug, status: "error" });
     throw err;
   }
   ```
5. Sentry alerts when a check-in is missed (cron didn't run) or
   reported error.

Alternative if Sentry crons feel heavy: BetterUptime supports
heartbeat monitors. Each cron POSTs to a unique heartbeat URL on
success; BetterUptime alerts when no heartbeat received within
the expected window.

### 3. Vercel Deployment Hooks → Slack (already free)

In each Vercel project → Settings → Git → Deploy Hooks:
- Failed deploys post to a #ops channel
- Catches build/runtime regressions before users notice

## What to set up TODAY

If you want the absolute minimum to not be flying blind:

1. **Install BetterUptime free tier** (10 min) — point at the 5
   `/api/health` URLs above, alerts via email.
2. **Set Vercel Slack integration** for failed deploys (5 min) —
   Vercel project → Integrations → Slack.

That covers "is the site up" and "did the last deploy fail" — 90% of
"things are broken" alerts.

The Sentry cron monitor wiring is more work (needs code change per
cron) — leave for the next sprint unless a specific cron has been
silently failing.

## What to verify in Supabase dashboard

Cannot be checked from code:

1. **Point-in-Time Recovery (PITR)** — Supabase Pro plan add-on.
   Settings → Add-ons → Point-in-Time Recovery. Without this, only
   daily snapshot backups are kept (7-day retention). With PITR you
   can restore to any second within a 7-day window, which matters if
   you ever hit a "we just deleted production data 3 minutes ago"
   moment.
2. **Database read replica** — only relevant once Postgres CPU is
   regularly above 50% (you're nowhere near).
3. **IP allowlist on the database** — Settings → Database → Network
   Restrictions. Restricting Supabase to Vercel's egress IPs adds a
   meaningful layer of defense in depth on the service-role key.
