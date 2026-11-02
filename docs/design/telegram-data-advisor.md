# Telegram Data Advisor ("ask the business anything" bot)

Scoped 2026-06-12 via office-hours. Decision: **full advisor vision, staged** — with usage-gated stages (stage N+1 only starts after stage N is in daily use).

## Problem Statement

Ammar's business questions fail in three recurring ways:
1. **Away from Mac → interrupts staff.** WhatsApps/calls a manager to check something they have to dig up.
2. **Away from Mac → question goes stale.** Waits until back at laptop; question forgotten or moment passed.
3. **At Mac → backoffice can't answer.** Dashboards lack the specific cut; falls back to Claude Code / raw SQL.

The third failure mode is the tell: the job is **ad-hoc questions dashboards were never going to pre-build**. That's an agent-with-SQL job, not another dashboard.

## Demand Evidence

Self-evident — the target user is the owner, and all three failure modes were confirmed from recent memory (last 3 failed questions). Risk is not demand; risk is scope (see Premises).

## Status Quo (what happens now)

- Backoffice at backoffice.celsiuscoffee.com (fixed dashboards; good for known questions).
- Claude Code on the Mac with Supabase MCP (answers anything, but desk-bound).
- WhatsApp/Telegram to managers (costs their time, gets approximate answers).
- Giving up (question never answered).

Cost: manager interruptions, stale decisions, and the owner being the only query engine for his own business.

## Target User

Ammar (owner). Promoted by: hitting Misi 2026 (4 new outlets, RM8M) and fixing the COGS overspend. Kept up at night by: cashflow squeeze, RM112k stuck POs, per-outlet profit. Later (stage-gated): ops managers — but that changes the data-access story (payroll!) and is explicitly out of v1.

## Narrowest Wedge (= Stage 1, not a throwaway)

A Telegram bot where Ammar asks plain-language questions and an agent answers by running **read-only SQL** on the single Supabase project (`kqdcdhpnyuwrxqhbuyfl`) with a business-context system prompt. Text answers only. No writes, no charts, no alerts. Same agent loop the full vision runs on — later stages add tools, not rewrites.

Note: "all the databases" is in practice ONE database. Sales (pos_orders + archived storehub_*), HR (hr_*), inventory/procurement, finance (BankStatement, COA), loyalty — all already live in `kqdcdhpnyuwrxqhbuyfl`. Old project `akkwdrllvcpnkzgmclkk` is a frozen safety net: excluded.

## Premises (explicit assumptions)

- One Supabase project covers ≥90% of real questions; external sources (Sentry, GBP, ads) are rare-question territory.
- Read-only is non-negotiable until trust is established. Write actions are a different risk class than the staff-app "warn+allow" philosophy.
- A Telegram chat-ID allowlist (Ammar only) is the entire authz model for v1. Adding anyone else forces row/table-level scoping first.
- Scope creep is the known failure pattern (HR 3→10 tables, Mujtama'OS). Usage gates between stages are the countermeasure.

## Architecture (all stages share this)

- **Bot**: new dedicated Telegram bot via BotFather (do NOT reuse the POP-ingestion bot — keep flows isolated). Webhook + secret token.
- **Runtime**: API route in apps/backoffice (`/api/telegram/advisor`), Vercel `maxDuration: 300`, agent loop via Anthropic API tool-use (or Agent SDK). Zero new infra; secrets already on Vercel.
- **DB access**: dedicated Postgres role `advisor_readonly` — `GRANT SELECT` only, `default_transaction_read_only = on`, `statement_timeout` ~10s, row-limit guard in the tool. Never the service-role key. (Respects the no-`prisma db push`, manual-SQL-migrations rule.)
- **Tools (staged)**: `execute_sql` (stage 1) → digest cron (stage 2) → Sentry/Vercel/GBP/Google Ads/Indeed connectors (stage 3) → threshold watchers + advice (stage 4).
- **Context**: system prompt = schema map + business rules (outlets & entities, rounds, COGS 35% target, AOV RM40, tier engine, Grab gross+commission, SST=0, OT flooring…). Much of this already exists as Claude memory — port it.
- **Conversation memory**: `advisor_messages` table keyed by chat ID so follow-ups work ("ok now Tamarind").
- **Authz**: hard chat-ID allowlist; unknown chat → silent drop + log.

## Approaches Considered

### Approach A — Wedge only (days)
Stage 1 alone: bot + read-only SQL agent + context prompt + conversation memory. Daily value within a week. Risk: under-delivers on "advisor"; mitigated by the roadmap existing.

### Approach B — Wedge + digest + first connectors (weeks)
Stages 1–2 (+8am digest: yesterday by outlet/round vs targets, COGS flags, aging POs) and 1–2 external tools chosen by demand. Risk: digest design rabbit-hole; mitigate by shipping digest v1 as the answer to a fixed question.

### Approach C — Full advisor, staged (months)
All stages incl. proactive threshold alerts (COGS overspend, AWAITING_DELIVERY aging, round-target misses) and recommendation mode. Shares Telegram+agent infra with the planned Marketing AI Agent (docs/design/marketing-ai-agent.md) — build the bot plumbing once.

## Recommended Approach

**C as the committed roadmap, A as milestone 1, usage-gated.** Concretely:

- **Stage 1 (week 1)**: read-only Q&A live, Ammar-only.
  Gate: ≥5 real questions/week answered without opening the laptop, for 2 consecutive weeks.
- **Stage 2**: morning digest cron.
  Gate: digest read (not muted) 5 days straight.
- **Stage 3**: external connectors — each added only when a real question failed for lack of it. Log every failed question; that log IS the stage-3 backlog.
- **Stage 4**: proactive alerts + advice mode.
  Gate: at least 3 alert thresholds Ammar has manually asked about repeatedly.

Evidence that would flip this: if stage 1 logs show >30% of questions failing because they need non-DB sources, pull stage 3 forward.

## Open Questions

- Vercel 300s ceiling: enough for multi-query agent turns? If not, fallback = Supabase Edge Function or a small Fly worker.
- Model: Fable/Sonnet per question (~cents) vs Haiku for cheap follow-ups. Decide after seeing real question complexity.
- Chart images (QuickChart → PNG to Telegram): stage 2 nice-to-have or noise?
- When managers join: per-role table grants (exclude hr_ payroll) — design before invite, not after.
- e-Invoice/TIN data, bank lines still draft-only in finance ledger — answers from finance tables must caveat completeness (BS/CF incomplete).

## Success Criteria (measurable)

- ≥5 questions/week answered in Telegram, sustained 4 weeks.
- Manager "can you check X for me" interruptions ↓ (self-reported).
- Zero write incidents (role makes them impossible — verify with a canary attempt).
- Failed-question log <20% of total by week 4.
- Stage gates passed in order; no stage started early.

## The Assignment (one concrete next step)

**Before any code: 3 days of question logging.** Every business question that pops into your head — at an outlet, in bed, mid-meeting — type it into a Telegram "Saved Messages" note with where you were. Target 15–20 real questions. That log becomes (a) the v1 eval set, (b) the system-prompt scope, and (c) the proof of which external sources stage 3 actually needs. Then create the bot with BotFather and kick off stage 1.
