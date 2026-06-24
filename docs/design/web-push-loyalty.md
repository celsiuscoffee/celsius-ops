# Web push for loyalty nudges

_Office-hours scoped 2026-06-23. Status: scoped, build approved (Approach A)._

## Problem Statement
The loyalty PUSH triggers (Points-sitting-unused, Birthday treat, Lapsed win-back, Tier about to lapse, Voucher expiring soon) run daily but SENT ≈ 0. Push reach is tiny: only **47 of ~2,298 active members** have a native `expo_push_token`, and **web push is coded but dead** — `sw.js`, VAPID env, the `web-push` lib, and `/api/push/{subscribe,send,blast,...}` all exist, but the `push_subscriptions` table was never created (subscribe 500s → 0 web subs) and the route is **order-keyed, not member-keyed**, so it can't target a loyalty member. Most customers use the web PWA (order.celsiuscoffee.com), not the native app.

## Demand Evidence
Weak-to-speculative. The SMS loop engine already delivers these exact nudges at full reach (live). The stated driver is **engagement** — belief that push converts better than SMS — but this is a **hypothesis, not evidence**. No push-vs-SMS conversion data exists yet (loops just launched; push reach = 47, and those 47 are the most app-engaged customers → selection bias). Owner chose to build anyway, accepting it's a bet until reach grows. **This doc treats it as a bet to be instrumented, not a proven need.**

## Status Quo (what users do now)
The live SMS loop engine (`loop-engine.ts`) already does **push-preferred → SMS-fallback per member** (push to the 47, SMS to the rest) for winback/welcome/birthday/round-gap/reward-expiring/points-idle. So the channel-choice + de-dup machinery already exists. The separate order-app push-campaigns system (the screenshot panel) is a push-only duplicate that is dark.

## Target User (named person, role, consequence)
The customer (e.g. Syahmikaberi, a returning Putrajaya member) who has the web PWA open but no SMS-worthy reason to come back today. Also Ammar (owner): wants free push to cut the RM0.10/SMS marketing bill as nudge volume scales. Consequence if push stays dark: every nudge costs SMS money + no richer channel.

## Narrowest Wedge
Make web subscriptions **a token source for the existing loop engine** — not a new sender. Then the loops already running deliver free push to web-subscribed members and SMS to everyone else, with de-dup + attribution for free.

## Premises (explicit assumptions)
- Push converts at least as well as SMS for a coffee nudge (UNPROVEN — the bet).
- Web push opt-in lands ~5–15% (so push supplements, never replaces, SMS).
- One message per member per campaign (never push AND SMS) — non-negotiable.
- VAPID keys are/will be set in the order project env (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`).

## Approaches Considered
### Approach A — web subs as a token source for the loop engine (days) ✅
Member-keyed `push_subscriptions` table; opt-in prompt at order-confirmation; extend the loop engine's push-token lookup to include web subs; send web push via `web-push`. Add a "tier-at-risk" loop. Retire the 5 dark duplicate push-campaigns. De-dup, channel-choice, and push-vs-SMS measurement all come free from the existing engine.
### Approach B — revive the standalone push-campaigns system (weeks)
Fix its table member-keyed, own cron, preference center. Re-creates double-messaging + split measurement that A avoids.
### Approach C — full omnichannel (months)
Per-campaign channel routing, rich push (image/deep-link), preference center, push-vs-SMS A/B framework.

## Recommended Approach
**A.** "Web push" becomes a new token source + an opt-in prompt, not a subsystem — reusing the live engine. Flips to B/C only if push must carry campaigns the loop engine doesn't run, or rich/visual push is wanted.

## Open Questions
- Opt-in prompt placement: order-confirmation (highest intent) vs account screen vs post-redemption. Start with order-confirmation.
- Service worker (`sw.js`) push-event handler: confirm it shows notifications + deep-links into the order flow.
- `push_subscriptions` schema: member_id + endpoint + p256dh + auth + (keep order_id for order-status push). One member can have many endpoints (devices).

## Success Criteria (measurable)
- Web push opt-in rate ≥ 10% of prompted logged-in members within 30 days.
- **Push-vs-SMS order conversion** read from `loop_assignments.channel` — push must be ≥ SMS (the bet); if push < SMS after meaningful volume, stop scaling push.
- SMS spend reduced by the share of nudges shifted to push (free).
- Zero members receive both push AND SMS for the same round.

## The Assignment (one concrete next step)
Before scaling reach: read the **push-vs-SMS conversion already forming in `loop_assignments.channel`** from the live loops (the 47 push sends vs the SMS sends). Confirm push actually out-converts SMS on real Celsius data — that's the bet, and it's measurable now for free. Build the opt-in/table in parallel, but let that signal decide whether to retire any SMS in favour of push.
