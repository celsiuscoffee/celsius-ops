# Choc Blanc — Merdeka Campaign Plan (31 Aug – 30 Sept 2026)

_Planned 2026-08-20. Owner: Ammar. Status: **backend staged, nothing public.**_

Launch of **Choc Blanc** — double espresso over ice, capped with whipped dark
chocolate cream, cocoa dust and candied orange peel — across four channels:
SMS, Instagram, the app posters, and the POS customer display.

Artwork supplied: A4 poster, `NEW ON THE MENU`, "MERDEKA MENU · 31 OGOS – 30 SEPT 2026",
"SELAMAT HARI MERDEKA KE-69", outlets Shah Alam · Conezion · Tamarind.

---

## 1. What is already staged (and provably invisible)

Everything below is live in the production DB but gated off. Verified with the
same queries the readers use — 0 leaks on all four surfaces.

| Thing | ID | Gate |
| --- | --- | --- |
| Product `Choc Blanc` | `choc-blanc` | `is_available=false` **and** `visible_channels={none}` |
| Voucher `RM3 off Choc Blanc` | `8b19f425-4a6b-42f8-883a-3be43ccc377e` | `is_active=false` |
| POS display poster | `740fc57d-d2d8-49e0-959a-f004cb7355fe` | `active=false`, `starts_at` 31 Aug |
| App home poster | `a0d810a8-0597-4a4d-9162-e2e6b5b74ea3` | `active=false`, `starts_at` 31 Aug |
| App splash poster | `400f637d-4aad-4684-9c26-5fb7964ba874` | `active=false`, 31 Aug – 2 Sept |

Product details: category `classic` (next to Mont Blanc), RM14.90, `tax_rate` 0 /
`tax_inclusive`, kitchen station `Bar`, modifiers cloned from Mont Blanc
(Add On: Extra Shot +RM3, Extra Syrup +RM2; Packaging +RM0.90 on Grab).

**Two gates, not one, and deliberately so.** The `pos-poster-autopilot` cron is
**enabled** and runs daily at 07:00 MYT; it flips `active`/`sort_order` on home
and pos-display posters on its own. So `active=false` is *not* a safe staging
guard by itself — a future `starts_at` is what actually holds the line, because
every reader filters on the schedule window. Both are set.

**The POS poster is pinned deliberately with `round = NULL`.** The autopilot only
considers pos-display posters with a non-null round (`poster-autopilot.ts:151`),
so a round-less poster is outside its control and shows in every day-part while
active. That is what we want for a launch.

### The one field still blank: `image_url`

I have no Cloudinary credentials in this session, so I could not host the
artwork. All three poster rows carry `image_url = ''`. **If they go active on
31 Aug with that still empty, the slot renders blank on customer-facing
screens.** The go-live checklist below fails loudly on this.

I did render upload-ready crops from your A4 at each surface's true aspect ratio
(read from the components, not guessed):

| File | Ratio | Where it goes | Source |
| --- | --- | --- | --- |
| `choc-blanc-POS-display-1080x1320.jpg` | 0.818 | POS customer display side panel (460×~562, `cover`) | `pos-native/app/customer-display.tsx:820` |
| `choc-blanc-APP-home-1200x1121.jpg` | 1.07 | App home + web carousel | `pickup-native/app/index.tsx:455`, `order/_PosterCarousel.tsx:80` |
| `choc-blanc-SPLASH-story-1080x1920.jpg` | 9:16 | App splash + IG story | `pickup-native/components/SplashPoster.tsx` |
| `choc-blanc-IG-feed-1080x1350.jpg` | 4:5 | Instagram feed | — |

⚠️ **The A4 does not fit the app carousel.** That surface is near-square (1.07:1)
and the artwork is 0.71:1 portrait — a `cover` fit would slice off the headline.
My `APP-home` file is a *recompose* (glass band + NEW/title/subtitle band, body
copy dropped) and there is a faint seam where the bands meet. It is good enough
to ship; a purpose-made 1.07:1 crop from the designer would be better. This is
the only real artwork gap. **RESOLVED 2026-08-29** — all three posters
and the catalogue photo are rendered and uploaded; `image_url` is set on every
row. See the 2026-08-29 entry in `docs/STATE.md` for how, and for the two
dashboard cleanups still owed.

---

## 2. Decisions — settled 28 Aug

1. **Choc Blanc does NOT replace Mont Blanc.** Both stay on the menu. Step 6 of
   the runbook (retiring Mont Blanc) is therefore **dead — do not run it**.
   Because they coexist at the same RM14.90, expect cannibalisation: measure
   **net units across both SKUs**, not Choc Blanc in isolation. Mont Blanc's
   410 units / RM6,108 per 30d is the combined baseline to beat.
2. **Price confirmed: RM14.90**, Mont Blanc parity.
3. **Cost per cup: RM3.4471** — Mont Blanc's recipe plus 10g chocolate powder.
   A `Menu` row (`storehubId = 'choc-blanc'`) now carries a 9-line BOM cloned
   from Mont Blanc's 8 lines plus `Chocolate Powder` 10g @ RM0.089/g = RM0.89.
   `products.cost` is set, which unblocks margin **and** the home-poster
   autopilot ranking (§6). Margin at RM14.90 is **76.9%**.

   Two caveats worth knowing:
   - `menu_margins.recipe_cost` reads **RM5.3448**, not RM3.4471, because that
     view sums *every* BOM line including both modifier variants — it bills an
     extra shot *and* an oat-milk swap into the base cup. Mont Blanc has the
     same distortion (RM4.4548 vs a true RM2.5571). The view overstates cost on
     any recipe with modifier lines; treat its margin_pct as a floor.
   - `Dried Orange Peel` is still uncosted (`uncosted_ingredients = 1`), carried
     over from Mont Blanc. Real cost per cup is RM3.4471 *plus* that peel.

## 3. Go-live runbook (31 Aug, ~07:00 MYT)

Run top to bottom. Steps 1–2 are the ones that can embarrass us.

```sql
-- 1. PRE-FLIGHT: must return zero rows, or STOP (blank posters on screens).
select id, placement, title from splash_posters
 where title like '%Choc Blanc%' and coalesce(image_url,'') = '';

-- 2. DONE 2026-08-29 — artwork is already attached; do NOT re-run an update
--    here, it would replace working URLs. Verify instead (expect 3 rows, all
--    -v-suffixed keys under posters/promo/):
select placement, split_part(image_url, '/posters/', 2) as key
  from splash_posters where title like '%Choc Blanc%' order by placement;
--    Re-uploading later needs a NEW key: objects are written
--    Cache-Control: immutable, so overwriting a key serves stale bytes.

-- 3. Put the drink on sale (all channels).
update products set is_available = true, visible_channels = '{}', updated_at = now()
 where id = 'choc-blanc';

-- 4. Turn the posters on. REQUIRED — home is already active=true but splash
--    and pos-display are active=false, and every reader needs active AND the
--    schedule window. Nothing switches itself on.
update splash_posters set active = true, updated_at = now()
 where title like '%Choc Blanc%';

-- 5. Arm the SMS trial voucher (only if running the voucher arm, §4).
update voucher_templates set is_active = true, updated_at = now()
 where id = '8b19f425-4a6b-42f8-883a-3be43ccc377e';

-- 6. DEAD STEP — Choc Blanc sells ALONGSIDE Mont Blanc (§2). Do not run.
```

**Rollback** — the reverse of steps 3–5, all single UPDATEs:

```sql
update products         set is_available=false, visible_channels='{none}' where id='choc-blanc';
update splash_posters   set active=false  where title like '%Choc Blanc%';
update voucher_templates set is_active=false where id='8b19f425-4a6b-42f8-883a-3be43ccc377e';
```

**Also on launch day, off-system:** brief the outlets. The poster says "*Now*
capped with…" — staff will be asked "what changed?" and should have one sentence
ready, plus the upsell from Mont Blanc. The `staff-briefing-generator` skill
covers the format.

**End of campaign (30 Sept, 23:59 MYT):** posters expire on their own via
`ends_at` — no action. The product does **not**; decide then whether Choc Blanc
stays on the menu or gets hidden.

---

## Campaign structure (31 Aug – 30 Sept)

Four phases. Each has **one goal, one offer, one thing staff do** — that is the
whole point of naming them: everyone from the till to the P&L uses the same
four words.

| | Phase | Dates | Offer | Goal | Staff job |
| --- | --- | --- | --- | --- | --- |
| 1 | **LAUNCH WEEK** | 31 Aug – 6 Sept | **B1F1** (SMS holders only) | Get it into hands, and a 2nd person tasting | Explain the drink, handle vouchers |
| 2 | **FULL PRICE** | 7 – 15 Sept | none | Find out if it sells at RM14.90 unaided | Upsell from Mont Blanc |
| 3 | **HARI MALAYSIA** | 16 – 22 Sept | **B1F1 — fresh pool** (Round C) | Extend trial to people the launch never reached | Same voucher rules as Phase 1 |
| 4 | **LAST CALL** | 23 – 30 Sept | none — deadline only | Convert the undecided | "Last week for it" |

**The phase dates are SEND windows, not voucher lifetimes.** The drip runs five
days and each voucher lives 7 days from issue, so Phase 1 vouchers stay
redeemable into Phase 2 (last ones expire ~10 Sept) and Phase 3's into Phase 4
(~27 Sept). Staff honour any voucher that is in the account and unexpired,
whatever phase the calendar says — the briefing leads with that rule, because
the obvious reading ("Phase 2: no offer") would have them refusing live
vouchers in week two.

**Phase 2 is not a gap, it is the measurement.** It is the only window where you
learn whether people buy Choc Blanc at RM14.90 without being paid to. Discount
the whole month and all you learn is that customers like free coffee.

**Phase 3 repeats B1F1 to a DIFFERENT pool (owner decision, 29 Aug).** The risk
with a second giveaway is teaching the base to wait for the free one — but that
only applies if the *same people* get it twice. Round C therefore excludes
everyone the launch touched, so nobody is offered B1F1 more than once and the
offer stays a first-taste mechanic rather than a recurring discount.

Round C also re-runs the announce-vs-B1F1 randomisation on fresh people, which
roughly doubles the sample behind the "does a new product need discounting"
question instead of leaving it on one week's data.

The 14-day `celebration` cooldown from 30 Aug is not a factor: Round C's pool is
people who were never contacted on 30 Aug.

**Supporting beats:** the `reward_expiring` loop fires around 6 Sept to
unredeemed B1F1 holders (automatic, highest-yield send in the plan). Posters run
the full month on all three surfaces and expire on `ends_at` 30 Sept.

## 4. Channel 1 — SMS

### The reach reality

| | |
| --- | --- |
| Members | 25,992 |
| SMS-reachable (not opted out) | 25,990 |
| **Active ≤60d** (the celebration segment) | **5,928** |
| Active ≤30d | 3,961 |
| Members with a push token | **123** |

**Push is not a channel.** 123 tokens across 26k members — 80 of them among the
5,928 actives. The loop engine prefers free push and falls back to paid SMS, so
in practice ~99% of this campaign is paid SMS at RM0.10. A full actives blast is
**~RM593**. (Worth fixing push adoption — separately, not in this campaign.)

### What the measured loops actually say

From `loop_rounds` (rounds sent 11–13 Aug, holdout-controlled):

| Loop | Lift vs holdout | Revenue / recipient |
| --- | --- | --- |
| `reward_expiring` | **+10.3 to +19.0 pp** | **RM5.44 – 8.64** |
| `winback` | −33.3 to +9.5 pp | RM0.30 – 3.47 |
| `fresh_lapse` | −12.5 to +8.3 pp | RM0 – 2.92 |

Two lessons, and they shape the whole SMS plan:

1. **The only loop that reliably works is reminding someone about a reward they
   already hold, with an expiry.** Cold "come back" offers are noise.
2. **Those win-back rounds are unreadable anyway** — 18–30 per arm and holdouts
   of 5–10. You cannot detect a 3–5pp difference at n=20. Any conclusion drawn
   from them is a coin flip. This campaign should fix that by running **fewer,
   bigger arms**.

### The design — three sends

Merdeka (31 Aug) and Malaysia Day (16 Sept) are already in the engine's
`CELEBRATIONS` table, and the `celebration` loop (actives ≤60d, 14-day cooldown,
400/day) does fire in the eve/day window. **But it cannot carry this campaign —
an earlier draft of this section claimed it could, and that was wrong**
(`loop-engine.ts:1100`):

- its template is fixed and **requires an `{offer}`**, so the announce-only arm
  cannot run through it at all;
- its offer comes from `candidateKeys: [b1f1_drinks, flat10_min30,
  pct15_min40]` — **the Choc Blanc voucher is not among them**, so it would send
  "buy 1 free 1 on any drink" and never mention Choc Blanc;
- it uses `holdoutPct: 10`, not the 20 assumed below.

The manual path (`POST /api/loyalty/sms/blast`) takes a raw `phones[]` and one
`message`: no segmentation, no holdout, no arm split, no voucher issuance.

**Resolved 29 Aug** by two small additions to `loop-engine.ts`, so Send A now
runs through the normal `prepareRound` → `scheduleRound` → `sendRound`
lifecycle with its measurement intact:

- `ArmDef.voucher_template_id` is now `string | null`. A null arm is
  **announce-only**: it mints nothing and costs no COGS. This is what lets a
  round test whether an offer is needed at all.
- `prepareRound` gained `onlyPhones` — an allowlist applied after
  `suppressPhones`, so one audience can be split into behaviour-defined groups
  without expressing the complement as a huge suppression list.

Send C uses the same announce-only arm. Send B needs neither —
`reward_expiring` is `noIssue` and picks up unredeemed vouchers on its own.

**Send A — 30 Aug, Merdeka eve.** Owner decision 29 Aug: **don't discount the
people already sold.** Split by past behaviour, not at random:

- **Round A — the 538 identifiable Mont Blanc buyers: announce only.** They
  already buy the base drink at RM14.90; paying them to switch is pure margin
  given away.
- **Round B — everyone else in actives ≤60d: announce vs Buy 1 Free 1,
  randomised**, capped at 1,500 → ~600/arm after a 20% holdout, ~RM150. The
  randomisation sits *inside* the cold segment, which is where "is the offer
  worth it" actually lives. Enough to read a 3–5pp difference, unlike every
  win-back round to date.

**Why the split cannot be the experiment.** Comparing Round A to Round B tells
you nothing about the offer — the groups differ in the very thing that predicts
buying. Round B's internal randomisation is what carries the learning.

**And a data limit worth stating plainly.** "Hasn't bought Mont Blanc" really
means "we have no record of it". Purchases link to a person only via
`customer_phone` on our own POS and app — 55% of `pos_orders` tickets, 28% of
`orders`, and **nothing at all before Apr/Jun 2026**. Of 167,012 transactions
since 2022, ~13,700 (8%) are attributable to anyone. Mont Blanc sells 410 units
a month against 575 identifiable all-time buyers, so most of its drinkers are
invisible to us and will land in Round B. Round A is a clean list; Round B is
"everyone we can't rule out". Exact recipe below.

**Send B — ~6 Sept, expiry reminder.** No new build: the voucher's 7-day validity
means the existing `reward_expiring` loop picks up unredeemed Choc Blanc vouchers
automatically. This is the highest-yield send in the plan, per the table above.
Only applies to the B1F1 arm.

**Send C — 16 Sept, Malaysia Day.** Announce-only arm again, ideally suppressing
anyone who already bought Choc Blanc. Half-time nudge plus the "on until 30 Sept"
deadline.
> `Happy Malaysia Day! Choc Blanc is on until 30 Sept - double espresso capped with dark chocolate cream. Shah Alam, Conezion, Tamarind.` — 132 chars

### Send A — the exact recipe (30 Aug, Merdeka eve)

Two rounds, because the split is by past behaviour and must NOT be random.
Both go out on **30 Aug**, so the first vouchers can be redeemed the moment
the outlets open on the 31st. Copy says "from tomorrow" for that reason.

**The buyer list** (538 people as of 29 Aug) — `onlyPhones` for Round A,
`suppressPhones` for Round B:

```sql
select distinct o.customer_phone as phone
  from pos_orders o join pos_order_items i on i.order_id = o.id
 where o.customer_phone is not null and i.product_name ilike '%mont blanc%'
union
select distinct o.customer_phone
  from orders o join order_items i on i.order_id = o.id
 where o.customer_phone is not null and i.product_name ilike '%mont blanc%';
```

**Round A — known Mont Blanc buyers. Announce only, no offer.**

```jsonc
POST /api/loyalty/loops/prepare
{
  "loopKey": "celebration",
  "onlyPhones": ["<the 538 above>"],
  "holdoutPct": 20,
  "arms": [{
    "key": "announce",
    "label": "Announce only",
    "voucher_template_id": null,
    "message": "Selamat Hari Merdeka! NEW at Celsius from tomorrow: Choc Blanc - double espresso capped with dark chocolate cream. RM14.90. Shah Alam, Conezion, Tamarind."
  }]
}
```
~430 sent, ~RM43, zero COGS.

**Round B — everyone else in actives ≤60d. Announce vs B1F1, randomised.**

```jsonc
POST /api/loyalty/loops/prepare
{
  "loopKey": "celebration",
  "suppressPhones": ["<the same 538>"],
  "maxRecipients": 1500,
  "holdoutPct": 20,
  "arms": [
    { "key": "announce", "label": "Announce only", "voucher_template_id": null,
      "message": "Selamat Hari Merdeka! NEW at Celsius from tomorrow: Choc Blanc - double espresso capped with dark chocolate cream. RM14.90. Shah Alam, Conezion, Tamarind." },
    { "key": "b1f1", "label": "Buy 1 Free 1", "voucher_template_id": "a0e3661c-5cba-454f-a50a-1cebd597225f",
      "message": "Selamat Hari Merdeka! NEW Choc Blanc at Celsius from tomorrow. Your {reward} expires {expiry} - just give your phone no. at any outlet." }
  ]
}
```
~1,200 sent (~600/arm), ~RM120 SMS. B1F1 COGS only on redemption.

Both messages fit one GSM-7 segment: 154 chars, and 143 once `{reward}` /
`{expiry}` resolve. Verify in the dashboard preview before scheduling.

Then `POST /api/loyalty/loops/schedule` with `scheduled_send_at` = 30 Aug
evening MYT for each round. The cron sends prepared+scheduled rounds; nothing
leaves until then, and `/api/loyalty/loops/cancel` unwinds a prepared round.

### Sends go out DAILY, not in one blast

Owner decision 29 Aug. A single B1F1 blast to ~1,200 people lands its
redemptions in the first two days, on three outlets, on a public holiday. Drip
it instead: **~300 recipients per day**, so the extra cups arrive at a rate the
bar can actually make.

| Round | Days | Per day | Total |
| --- | --- | --- | --- |
| A — Mont Blanc buyers, announce | 30 Aug (one go) | 538 | 538 |
| B — cold pool, announce vs B1F1 | 30 Aug – 3 Sept | ~300 | 1,500 |
| C — fresh pool, announce vs B1F1 | 16 – 20 Sept | ~300 | 1,500 |

Round A can go in one day: an announcement with no voucher doesn't create a
redemption spike.

**Prepare each day's round ON that day — never all five up front.**
`issueReward` stamps `expires_at = now() + validity_days` at *prepare* time
(`loop-engine.ts:514`), so five rounds prepared on day 0 would hand the day-5
recipients a "7-day" voucher with two days left on it. One prepare per day keeps
every recipient's week honest.

Each day suppresses everyone already assigned in this campaign:

```sql
-- suppressPhones for the next daily round
select distinct phone from loop_assignments
 where round_id in (select id from loop_rounds
                     where loop_key = 'celebration'
                       and created_at >= '2026-08-30'); -- this campaign's rounds
```

Pooling for the readout is normal — the engine already measures multi-round
loops that way. Each daily round carries its own 20% holdout and its own arm
split; you sum them at the end.

### Round C — Hari Malaysia, fresh pool (16 – 20 Sept)

Same two arms, same B1F1 template, a pool that has never been contacted for this
campaign. Reachable actives ≤60d are **6,413**, of which Rounds A+B consume
~2,038 — leaving ~4,300 before excluding anyone who has bought Choc Blanc by
then, so 1,500 is comfortable.

```jsonc
POST /api/loyalty/loops/prepare        // once per day, 16–20 Sept
{
  "loopKey": "celebration",
  "suppressPhones": ["<all phones assigned in Rounds A, B and earlier C days>",
                     "<plus anyone who has already bought Choc Blanc>"],
  "maxRecipients": 300,
  "holdoutPct": 20,
  "arms": [
    { "key": "announce", "label": "Announce only", "voucher_template_id": null,
      "message": "Happy Malaysia Day! Try Choc Blanc at Celsius - double espresso capped with dark chocolate cream. RM14.90, on until 30 Sept. Shah Alam, Conezion, Tamarind." },
    { "key": "b1f1", "label": "Buy 1 Free 1", "voucher_template_id": "a0e3661c-5cba-454f-a50a-1cebd597225f",
      "message": "Happy Malaysia Day! Choc Blanc at Celsius - double espresso, dark chocolate cream. Your {reward} expires {expiry} - just give your phone no." }
  ]
}
```

Add the Choc Blanc buyers to the suppression — they've already tried it, so B1F1
to them is margin given away:

```sql
select distinct o.customer_phone from pos_orders o
  join pos_order_items i on i.order_id = o.id
 where o.customer_phone is not null and i.product_name ilike '%choc blanc%'
union
select distinct o.customer_phone from orders o
  join order_items i on i.order_id = o.id
 where o.customer_phone is not null and i.product_name ilike '%choc blanc%';
```

Both messages fit one GSM-7 segment (155 and 156 resolved). The
`reward_expiring` loop then picks up unredeemed Round C vouchers around
23–27 Sept on its own, which lands neatly in Phase 4.

### How redemption actually works

**Nothing to show, nothing to scan.** The voucher is issued to the member's
account at prepare time and sits in their wallet. At the till staff key the
customer's phone number into the POS
(`GET /api/pos/loyalty/lookup?phone=…` → `/rewards?member_id=…` → `/redeem`),
the voucher appears, and they apply it. The customer just says their number —
no code, no screenshot, no app needed. The SMS copy says "just give your phone
no." for that reason.

**Offer economics** (cost per redemption, against RM11.45 at full price):

| | Revenue | COGS | Margin |
| --- | --- | --- | --- |
| Full price | RM14.90 | RM3.45 | **RM11.45** |
| RM3 off | RM11.90 | RM3.45 | RM8.45 |
| B1F1 | RM14.90 | RM6.89 | **RM8.01** |

B1F1 costs 44 sen more per redemption than RM3-off for ~5× the perceived
value (RM14.90 vs RM3.00), and the free cup puts the drink in a second
person's hand. That is why the launch offer is B1F1 and the RM3-off template
(`8b19f425-…`) stays inactive.

**Reading the result:** B1F1 books 2 units per redemption. Count *paid* cups,
not total cups, or units will look better than the cash does.

### Guardrails

- A **global 2-per-7-days cap** across all loops is already enforced
  (`app_settings.marketing_weekly_cap`). During campaign weeks the win-back /
  fresh-lapse / habit loops will eat that budget and silently `capped` these
  sends. **Lower their `dailyLimit` or pause them for the campaign weeks**,
  otherwise Send A reaches fewer people than planned.
- `sms_opt_out` is honoured by the engine's `reachable()` — no extra work.
- Do not split the segment into more than two arms. That is the mistake the
  existing rounds keep making.

---

## 5. Channel 2 — Instagram

**There is no Instagram integration in this repo** — no API, no scheduler, no
asset pipeline. Every post here is manual, and there is no automated path from an
IG impression to an order. Plan accordingly: IG is a **reach and desire** channel
in this campaign, not an attributable revenue channel. Any "IG revenue" number
would be invented.

The one honest link: put the **app link sticker** on stories pointing at
`order.celsiuscoffee.com`. App poster taps *are* tracked (`poster-tap` route +
`lib/poster/attribution.ts`), so traffic that lands and orders is measurable at
the app end.

**Calendar (6 posts + stories):**

| Date | Format | Content |
| --- | --- | --- |
| 31 Aug | Feed 4:5 | The hero poster. Launch + Merdeka. |
| 31 Aug | Story 9:16 | Same artwork + app link sticker. |
| ~3 Sept | **Reel** | The pour — dark chocolate cream over the double espresso, 7–12s, no talking. Highest-reach format; this is the one to put effort into. |
| ~8 Sept | Carousel | The detail story: cocoa dusting, candied orange peel, why "Blanc". |
| 16 Sept | Feed | Malaysia Day tie-in, "on until 30 Sept". |
| ~25 Sept | Feed/Story | Last week — scarcity, ends 30 Sept. |

Stories 2–3×/week throughout, always with the app link sticker.

**Caption for launch day** (bilingual, matching the poster's register):

> Selamat Hari Merdeka ke-69 🇲🇾
> Choc Blanc is new on the menu — double espresso over ice, capped with whipped
> dark chocolate cream, a dusting of cocoa and candied orange peel.
> Ada sampai 30 September. Shah Alam · Conezion · Tamarind.

---

## 6. Channel 3 — App posters

Three placements exist; this campaign uses all three.

- **Splash** (full-screen on launch, 9:16) — highest impact, most intrusive.
  Staged for **31 Aug – 2 Sept only**, then it expires on its own and the home
  carousel carries the rest of the month. Note there is already 1 active splash
  poster and the autopilot's splash top-K is 1 — **decide which one wins** those
  three days.
- **Home carousel** (1.07:1) — runs the full month, `deeplink=/product/choc-blanc`.
- `product_id` is set to `choc-blanc` on every row so the carousel's food/drink
  balancing classifies it correctly as a drink.

**Two things that will bite:**

1. **The carousel shows a maximum of 3 posters** (`selectHomePosters`, tight by
   design) and **8 home posters are already active**, of which only ~1 slot is
   reserved for a drink. Adding a poster is not the same as it being seen.
2. **The autopilot will re-rank it.** It scores home posters on measured
   deeplink-attributed AOV blended with a product margin/price/units heuristic. A
   brand-new poster has no measured AOV, so the margin term is what keeps it in
   contention. `products.cost` is now set (RM3.4471), which restores that term —
   but a zero-AOV poster is still a candidate to be **benched within a day**.
   Remaining mitigation if you want the slot guaranteed: set
   `app_settings.pos_poster_autopilot_enabled = false` for the launch fortnight
   and re-enable after.
   Note the autopilot does **not** filter on the schedule window — it selects
   every home poster for the placement regardless of `starts_at`/`ends_at`
   (`poster-autopilot.ts:145-151`) and flips `active`/`sort_order` daily at
   07:00 MYT. So the first ranking Choc Blanc faces is 07:00 on 31 Aug, seven
   hours after its window opens. (Readers *do* filter the window, which is why
   an early activation cannot leak.)

**Honest reach caveat:** the app is small — 123 push tokens is the best proxy we
have for installed-and-registered users. The app posters are a *conversion and
AOV* surface for people already ordering, not a volume driver. Do not expect them
to move the campaign.

---

## 7. Channel 4 — POS poster

**This is the highest-reach surface in the entire plan.** Every paying customer
at three outlets sees the customer display, versus 5,928 SMS recipients and a
small app base. If one channel deserves the attention, it is this one.

Mechanics: `/api/pos/posters` serves active pos-display posters inside their
schedule window, filtered to the current MYT day-part, ordered by `sort_order`,
cached 60s. It renders in a 460px-wide side panel with `resizeMode="cover"` —
hence the 0.818 crop.

**The problem: 23 pos-display posters are already active.** At ~4.5s each that is
a ~108-second rotation, and a customer at the till sees maybe 2–4 of them. A new
poster dropped into that queue is close to invisible.

**So it is staged pinned:** `sort_order = 1` and `round = NULL`, which puts it
first and — as noted in §1 — keeps the autopilot from benching it.

**Strongly recommended:** prune the rotation for the campaign. 23 posters is not a
rotation, it is a screensaver. Cutting to ~6 for the launch fortnight would give
Choc Blanc real exposure and probably help the other five too.

Mont Blanc's day-part mix (last 30d) if you'd rather target than pin always-on:

| Round | Units |
| --- | --- |
| lunch (12–15) | 114 |
| midday (15–17) | 73 |
| brunch (10–12) | 58 |
| evening (17–19) | 53 |
| dinner (19–21) | 45 |
| breakfast (8–10) | 35 |
| supper (21–23) | 31 |

Broad, which supports leaving it always-on for the launch. Note that assigning a
round hands the poster back to the autopilot.

---

## 8. Measurement

Baseline to beat: **Mont Blanc, 410 units / RM6,108 per 30 days.**

| Channel | Metric | Trustworthy? |
| --- | --- | --- |
| SMS Send A | Arm 1 vs Arm 2 vs holdout: order rate + Choc Blanc units, 7-day window | ✅ holdout-controlled, and finally powered at ~600/arm |
| SMS Send B | Redemption rate of expiring vouchers | ✅ |
| App posters | Poster taps → orders (`poster_events`, deeplink-attributed) | ✅ but small n |
| POS poster | None — no per-poster attribution at the till | ❌ infer from total units only |
| Instagram | Reach/engagement only | ❌ not revenue |

**The single number that matters:** Choc Blanc units/day across all channels vs
Mont Blanc's 13.7/day baseline — plus, if Arm 1 ≈ Arm 2, the standing lesson that
new products do not need discounting.

Margin on any of it requires `products.cost` (§2).

---

## Open questions

1. ~~Replaces Mont Blanc?~~ **Settled: sells alongside** (§2).
2. ~~Confirm RM14.90.~~ **Settled: confirmed** (§2).
3. ~~Cost per cup.~~ **Settled: RM3.4471** (§2).
4. Run the SMS voucher arm at all, or announce-only? (Arm 1 vs Arm 2 is the test.)
5. Prune the 23 POS posters for the campaign — yes/no?
6. ~~Who produces a proper 1.07:1 home-carousel crop?~~ **Done** — all three
   surfaces are cut from an extended plate so the glass is never clipped (§1).
