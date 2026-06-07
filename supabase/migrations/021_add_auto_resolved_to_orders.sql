-- Stale-order sweep: marks a customer order auto-closed by the hourly cron
-- (api/cron/sweep-stale-orders) when staff forgot to advance it past
-- preparing/ready, or it never surfaced on a till. Lets reporting distinguish
-- genuine staff-completions from auto-closes (a coaching signal). Additive +
-- defaulted so nothing existing is affected. Applied live via MCP 2026-06-07.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS auto_resolved boolean NOT NULL DEFAULT false;
