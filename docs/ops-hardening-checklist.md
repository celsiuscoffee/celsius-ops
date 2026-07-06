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

Note (updated 2026-07-05): ALL ~59 scheduled crons are now wired in code
via `cronRoute()` — 16 money-critical ones carry Sentry Cron Monitor
heartbeats (auto-create on first production run), the rest get Sentry
error capture. See `docs/monitoring-setup.md` §cron-heartbeats for the
tier list. Remaining dashboard step: Sentry → Crons → alert rule
(notify on missed check-in / error) once the monitors appear.

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

## 5. Loyalty RLS policy fix — ~~SUPERSEDED 2026-07-05~~

The live DB had drifted ahead of the repo migration files: the
`USING (true)` policies were already gone in production and anon DML on
the sensitive tables already revoked. The proposal SQL is marked
superseded in-file; the real live exposure (the `outlets` view) was
fixed the same day. See PR #802 and the live-DB correction in
`docs/rls-access-map-2026-07-05.md`. Nothing left to apply here.

## 6. hr_payroll_runs deny-all RLS — ~~DONE (already live)~~

Verified 2026-07-05 directly against production (`pg_class.relrowsecurity`):
`hr_payroll_runs` and `hr_payroll_items` both have RLS enabled with zero
policies (deny-all, service-role only). No migration needed.
