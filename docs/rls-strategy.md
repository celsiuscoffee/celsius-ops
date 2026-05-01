# Row-Level Security strategy

## Where we stand today

- Supabase Postgres holds 95+ tables
- 2 tables have RLS enabled: `orders`, `order_items`
- Every other table is accessed via `SUPABASE_SERVICE_ROLE_KEY` which **bypasses RLS unconditionally**
- That key lives in Vercel env vars and `.env.local` files on developer machines

The audit on 2026-04-30 flagged this as a critical defense-in-depth gap. If the service-role key ever leaks, the entire database is exposed — not just the rows the leaked-from app could legitimately touch.

## Two paths

### Path A — Write RLS policies on every member-facing table

Pros:
- Real defense in depth. Even with a leaked service-role key, an attacker can't pull data they wouldn't normally have access to (because policies enforce `auth.uid() = user_id` etc.).
- Future-proof. Once policies are in place, new code automatically inherits them.

Cons:
- ~25 tables minimum (members, transactions, redemptions, push_subscriptions, attendance, reviews, audits, …)
- Each policy needs to thread Supabase auth through Prisma → not always trivial because we authenticate via JWT cookie, not Supabase auth
- Risk of locking yourself out: a wrong policy on a join column can break a feature in production
- 1–2 week effort to do safely

### Path B — Harden the service-role key (defense-in-depth lite)

Pros:
- Reduces blast radius without rewriting access patterns
- 1 day of work

Cons:
- A leaked key is still very damaging — just less likely to leak

Concrete steps:
1. **IP allowlist on Supabase database** — Settings → Database → Network Restrictions. Add Vercel egress IPs (a few `/24` blocks). Localhost allowed for dev. After this, even a leaked service-role key can't be used from a random box.
2. **Quarterly key rotation** — calendar reminder. Rotate via Supabase dashboard, update Vercel env, redeploy. Takes 5 min.
3. **Sentry alert on unexpected egress** — if service-role-key is ever logged or returned in a response, Sentry catches it (would need a regex breadcrumb filter).
4. **Read-only replicas** — separate `SUPABASE_READONLY_KEY` for analytics/reporting endpoints. Most reads don't need write privilege. (Supabase Pro feature.)

## Recommendation

**Path B for now, Path A as the long-term destination.**

Reasoning:
- We're a small team. Spending 2 weeks on RLS policies is real opportunity cost.
- Path B closes 80% of the risk in 5% of the time (IP allowlist alone is a huge win).
- Path A makes more sense once we have a security engineer on staff or once the data set holds more sensitive PII (e.g. payment info) than it does today.

## What to do this week (Path B implementation)

1. **Find Vercel egress IPs** — log a request from each of the 5 deployed apps, capture `x-forwarded-for` or read Vercel's published IP ranges (https://vercel.com/docs/edge-network/regions). Cache the list.
2. **Supabase → Settings → Database → Network Restrictions** → enable, paste IPs, also add your office and home IPs for direct queries. Save.
3. **Test from a non-allowlisted IP** that an attempted connection fails.
4. **Calendar reminder**: rotate `SUPABASE_SERVICE_ROLE_KEY` on the 1st of every quarter (Jan/Apr/Jul/Oct). Steps:
   - Supabase → Project → API → "Roll" service-role key
   - Update Vercel → each project → Environment Variables → `SUPABASE_SERVICE_ROLE_KEY`
   - Redeploy each app (touch any file or trigger a manual deploy)
5. **Sentry breadcrumb filter** — wherever we have a logger, add a regex that scrubs anything matching `eyJhbGc...` (Supabase JWTs are JWT). One-time, ~30 min of work.

## What to do longer term (Path A scoping)

When ready, prioritize tables in this order (highest sensitivity first):

1. `members`, `member_brands`, `transactions`, `redemptions` — customer PII + reward state
2. `push_subscriptions`, `points_history` — customer activity
3. `attendance`, `payroll_runs` — employee PII + comp
4. `audits`, `audit_reports`, `checklists` — internal QA
5. `bank_statements`, `bank_statement_lines` — financial data (the cashflow stack we just built)
6. `outlets`, `users` — config tables (fine to leave service-role-only)

For each, write policies that key off `auth.uid()` (Supabase auth user id). For our JWT-cookie auth, this means setting `auth.uid()` server-side via `supabase.auth.setSession()` before the query — which means our Prisma calls would have to go through the JS client instead. That's the real cost — it changes the data layer. Plan accordingly.

## Status

- [ ] Path B step 1: identify Vercel egress IPs
- [ ] Path B step 2: enable Supabase IP allowlist
- [ ] Path B step 3: rotate service-role key
- [ ] Path B step 4: calendar reminder for quarterly rotation
- [ ] Path B step 5: Sentry secret-scrubbing filter
- [ ] Path A: scoping when business case arises
