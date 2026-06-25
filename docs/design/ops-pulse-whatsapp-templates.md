# Ops Pulse — WhatsApp templates

Proactive (business-initiated) ops-pulse messages sent **outside** a recipient's
open 24h window require an **approved WhatsApp template**. WhatsApp rejects
template parameters that contain newlines, tabs, or >4 consecutive spaces, so the
rich multi-line digest can't be a variable. Instead each template frames the
message with static text and a single `{{1}}` placeholder that carries a
**one-line, newline-free summary** (count + items joined by " · "). The full
per-item detail lives in the Ops chat inbox (`/ops/chat-inbox`).

The `{{1}}` content is produced by the `*Var` builders in
`apps/backoffice/src/lib/ops-pulse/sender.ts` (`dailyDigestVar`,
`managerDigestVar`, `escalationVar`). Keep the template body below in sync with
those if the framing changes.

Create these in **WhatsApp Manager → Manage templates → Create template**.
Category **Utility**, Language **English (`en`)** (if Manager only offers
`English (US)` = `en_US`, set `OPS_PULSE_TPL_LANG=en_US`). No header, no buttons.

## 1. Daily digest — needed for daily go-live

- **Name:** `ops_pulse_daily` → env `OPS_PULSE_TPL_DAILY=ops_pulse_daily`
- **Body:**
  ```
  ☀️ Daily Ops Pulse

  {{1}}

  Open Celsius BackOffice to clear these, or reply DONE as you go.
  ```
- **Sample {{1}}:** `6 open today · Stock-take overdue · 2 Google reviews to answer · Outlet audit due`

## 2. Real-time manager digest — needed only when the real-time tier is armed

- **Name:** `ops_pulse_digest` → env `OPS_PULSE_TPL_DIGEST=ops_pulse_digest`
- **Body:**
  ```
  🔴 Ops Pulse

  {{1}}

  Reply DONE when handled.
  ```
- **Sample {{1}}:** `2 need you · POS not opened at Bangsar · Phone capture 45% today`

## 3. Owner escalation — needed only when the real-time tier is armed

- **Name:** `ops_pulse_escalation` → env `OPS_PULSE_TPL_ESCALATION=ops_pulse_escalation`
- **Body:**
  ```
  ⚠️ Ops escalation

  {{1}}

  These are unacked past SLA.
  ```
- **Sample {{1}}:** `1 unacked past SLA · Bad review (1★) at KLCC unanswered 95 min`

## Go-live (daily)

1. Create `ops_pulse_daily` above and submit. Utility templates usually approve
   in minutes–hours.
2. When **Approved**, set in Vercel (backoffice project):
   `OPS_PULSE_TPL_DAILY=ops_pulse_daily`.
3. Flip `OPS_PULSE_DAILY_MODE=armed` when ready. The next 09:00 MYT run sends the
   framed template; staff replies open their 24h window (replies + further
   utility templates are then free) and surface in `/ops/chat-inbox`.

## Cost note

Per-message pricing (Meta, since 2025-07): each cold utility template is billed;
utility templates and free-form replies are **free inside an open 24h window**.
The "reply DONE" nudge is therefore also a cost lever — a reply zeroes that
recipient's WhatsApp cost for 24h. At ~25 sends/day this is order RM50–80/month
worst case (nobody replies); confirm the exact utility rate in WhatsApp Manager →
Billing.
