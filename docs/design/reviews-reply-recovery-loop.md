# Reviews Reply + Recovery Loop

_Office-hours diagnostic — 2026-06-23. Supersedes the GBP half of ads-conversion-loop.md._

## Problem Statement
Google reviews come in across 4 outlets and replies are ad-hoc. Two misses:
1. **Response rate is left on the table** — it's a real GBP rank lever (see
   [[project_reviews_goal]]), and most reviews go un-replied.
2. **Negative reviews dead-end.** An unhappy customer leaves 1★ and we never recover them —
   no apology, no path back, no capture. They stay anonymous and lost.

This extends the **live** Reviews module (GBP API, 4 outlets, QR gate — see
[[project_reviews_module]]). Not greenfield.

## What's a loop and what isn't
- **Review reply + recovery = a real loop.** Closes on a measurable outcome: recovery rate
  and repeat orders from recovered customers (frequency-aligned, North Star).
- **"GBP posts to improve rank" = a publisher, not a loop.** Rank isn't API-readable (proxy
  only), and Google has been deprecating `localPosts` via API — auto-posting may not even be
  available. Treat as a scheduled publisher (reuse round posters), phase 2, verify API first.

## Status Quo
Replies written by hand when someone remembers. No sentiment split, no recovery mechanism,
no capture, no audit trail. Negative reviewers are lost forever.

## Target User
- **Customers** leaving reviews (positive: want acknowledgement; negative: want it made right).
- **Adam Kelvin (area manager, recovery owner)** — handles escalated negatives + the private
  recovery line. **Ammar** — owns the rank outcome.

## Design

### Per-review pipeline
1. **Ingest** new review (Reviews module already polls GBP) + add reply-state tracking.
2. **Classify**: star → positive (4–5★) / negative (1–3★). On negatives, run a **risk
   classifier**: health, safety, injury, food poisoning, legal/lawyer, discrimination,
   refund demand, severe-anger keywords → **ESCALATE**; everything else → routine.
3. **Generate + post**:
   - **Positive (4–5★):** personalized thanks (reference what they praised), brand voice,
     per-outlet. **Auto-post.** (Biggest rank lever, near-zero risk.)
   - **Negative routine:** empathetic recovery reply — **no admission of fault, no arguing** —
     points to the **private recovery line**. **Auto-post** (operator chose full-auto).
   - **Negative risk-flagged:** **draft only → Telegram to Adam/Ammar** for approve/edit
     before posting. (The tripwire — see Decision Log.)
4. **Recovery capture:** the recovery line is a dedicated WhatsApp/form (NOT Adam's personal
   mobile in public). Reviewer messages it → capture name + number + review/outlet → write to
   loyalty DB as **recovered-detractor** → issue voucher (reuse existing voucher/promo system)
   → enroll in SMS win-back ([[project_sms_loop_engineering]]).
5. **Audit:** every auto-posted reply logged to a backoffice "Reviews Ops" tab (review, reply,
   timestamp), **editable after the fact**. The warn+allow+audit safety net under full-auto
   ([[feedback_staff_ops_soft_controls]]).
6. **Measure (loop closure):** response rate, time-to-reply, % negatives that reach the
   recovery line, vouchers redeemed, **repeat orders from recovered customers**. Plus the
   competitor-rank proxy trend from the dark feature ([[project_reviews_competitor_ranking]])
   as a coarse rank signal.

## Premises (verify before building)
1. **GBP API allows posting review replies** for these locations (Reviews module reads them;
   confirm reply-write scope is enabled).
2. The order/loyalty system can mint a voucher + tag a customer as recovered-detractor.
3. A dedicated recovery channel (WhatsApp number or a short form) exists or can be stood up.
4. GBP `localPosts` write is still available via API (for the phase-2 publisher) — likely NOT;
   verify.

## Approaches Considered

### Approach A — Positive auto-reply + risk-tiered negative recovery (the core loop, ~days–1wk) — RECOMMENDED
Positives auto-reply now (ships the rank lever immediately). Negatives: risk classifier →
routine auto-post / risky-to-Telegram, recovery line + voucher capture into loyalty.

### Approach B — Add publisher + ops dashboard + attribution (weeks)
Scheduled GBP post publisher (if API allows), "Reviews Ops" backoffice dashboard (queue,
audit log, recovery funnel), recovered-customer → repeat-order attribution, competitor-rank
trend wired in.

### Approach C — Fold into autonomous marketing agent (months) — defer
Reply + recovery + GBP posting orchestrated by [[project_marketing_agent]], Telegram-gated.

## Recommended Approach
**A now → B once recovery volume justifies a dashboard → C later.**

## Decision Log
- Negative-reply automation: operator chose **full-auto**. Built with a **risk-classifier
  tripwire** (health/legal/safety/discrimination/refund → human) by default; operator may veto
  the tripwire for pure full-auto (not recommended).
- Recovery path: **private recovery line + voucher capture** into loyalty (chosen). Adam's
  personal mobile is NOT placed in public replies.

## Open Questions
1. Recovery channel: dedicated WhatsApp Business number vs a short web form? (Form captures
   number more cleanly; WhatsApp lowers friction.)
2. Voucher value + guardrail — flat RM off? Margin-safe item (free coffee, low COGS)?
3. Risk-classifier keyword/severity list — who signs off on the escalation triggers?
4. Does GBP API still permit programmatic review replies + posts for these 4 locations?

## Success Criteria (measurable)
- Response rate → ~100% within 30 days (positives auto, negatives within SLA).
- Median time-to-reply under X hours.
- ≥ N% of negative reviewers reach the recovery line and get captured into loyalty.
- ≥ M recovered customers place a repeat order within 60 days (the real North-Star proof).
- Zero risk-flagged reviews auto-posted (tripwire holds).

## The Assignment (one concrete next step)
**Before flipping negatives to auto:** run the classifier + drafter in **shadow mode** on the
last 20 negative reviews across all outlets — generate the reply it *would* have posted, but
don't post. Read all 20. If none would have made things worse, flip auto on. If even one
would have (an admission, a misread of a serious complaint), you've just written your
risk-classifier rules. Watch before you automate the brand's public face.
