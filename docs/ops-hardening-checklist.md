# Ops hardening checklist — 2026-07-05

Human-action items batched from `docs/rls-strategy.md` (Path B, open since
the April audit), `docs/monitoring-setup.md` ("set up TODAY", never done),
and the 2026-07-05 RLS access map. Everything here is dashboard work no
agent can do; each item says how to verify it's done. Tick and date as you
go.

## 1. Supabase IP allowlist (~30 min) — biggest single win

Do this on **both** Supabase projects (main + loyalty `kqdcdhpnyuwrxqhbuyfl`).

- [ ] Collect Vercel egress IPs: https://vercel.com/docs/edge-network/regions
      (published ranges) — or log `x-forwarded-for` from one request per app.
- [ ] Supabase → Settings → Database → Network Restrictions → enable, paste
      the ranges, and add your office/home IPs for direct SQL access.
- [ ] Verify: from a phone hotspot (non-allowlisted IP), a direct Postgres
      connection with the service-role key must FAIL; the apps must still work.

Effect: a leaked service-role key becomes unusable from anywhere but Vercel.

## 2. Service-role key rotation (~15 min, quarterly)

- [ ] Supabase → Project → API → "Roll" the service-role key (both projects).
- [ ] Update `SUPABASE_SERVICE_ROLE_KEY` / `LOYALTY_SUPABASE_SERVICE_ROLE_KEY`
      in each Vercel project's env vars; redeploy each app.
- [ ] Also update any `.env.local` on dev machines.

A quarterly calendar reminder (1st of Jan/Apr/Jul/Oct, created 2026-07-05)
points back at this section. Next one due: **2026-10-01**.

## 3. Uptime monitoring (~15 min, free)

- [ ] BetterUptime (betterstack.com/uptime) free tier: one monitor per
      `/api/health` URL in `docs/monitoring-setup.md` §health-endpoints.
      1-min interval for order + backoffice; 5-min for the rest. Email alert
      to yourself (add the ops WhatsApp/Slack later).
- [ ] Vercel → each project → Integrations → Slack: failed-deploy
      notifications to an #ops channel.
- [ ] Verify: temporarily point one monitor at a bogus path and confirm the
      alert arrives, then fix it.

Note: the `reconcile-pending` payments cron now carries a Sentry Cron
Monitor heartbeat in code (auto-creates on first production run — check
Sentry → Crons and set the alert rule to notify you). The other 13 crons
remain unmonitored; wire them the same way if one bites.

## 4. Point-in-Time Recovery decision (~5 min to decide)

- [ ] Supabase → Settings → Add-ons → check whether PITR is enabled on the
      main project.
- Decision guide: without PITR you have daily snapshots (7-day retention) —
  a bad deletion can lose up to a day, and the DB is now the book of record
  for accounting + payroll. PITR (~USD 100/mo ≈ RM430) restores to any
  second in a 7-day window. Recommendation: **enable on the main project**
  once Bukku parallel-run data is the only copy; the loyalty project can
  stay on snapshots.
- [ ] Record the decision (either way) in `docs/STATE.md`.

## 5. Loyalty RLS policy fix (after this PR deploys)

- [ ] Confirm the pickup dashboard-stats API route is live in production.
- [ ] Review + apply `docs/proposals/2026-07-05-loyalty-rls-policy-fix.sql`
      (pre-apply verification steps are in the file header).
- [ ] Smoke test: order checkout, OTP login, pickup dashboard loyalty tab,
      POS loyalty lookup.
- [ ] Move the SQL under the loyalty migrations dir + update the access map.

## 6. hr_payroll_runs deny-all RLS (quick follow-up migration)

- [ ] One-liner migration on the main project:
      `ALTER TABLE hr_payroll_runs ENABLE ROW LEVEL SECURITY;`
      (matches the 20260502 batch; no policies = service-role only).
      Payroll table — review before applying per hard rule 6.
