# GBP Relevance Checklist — apply the non-review levers

_Derived from the demand-ranked target-keyword set (`lib/geogrid/target-keywords.ts`),
which was built from the Google Ads search-terms report (2026-06). Companion to
[[gbp-profile-optimizer]]._

## Why this exists
Reviews are **prominence** — they widen how far out you rank. They do **not** make
Google associate you with a specific search term. Ranking the *exact* keywords we
target is a **relevance** problem, and relevance has its own levers:
**categories → services/products → description → geo**. This checklist turns the
ranked keyword set into the concrete Google Business Profile edits that win those
terms. Ammar applies them by hand (a few minutes per outlet); the geogrid then
tracks whether the ranked terms actually move.

**Scope note:** competitor-brand searches (luckin, zus, starbucks, kopi kenangan,
coffee bean) are deliberately **not** here — no profile edit out-ranks a rival's
own profile for its brand. Those stay a paid-ads play.

## How to apply (where each lever lives in GBP)
- **Categories:** Business Profile → Edit profile → **Business category** (1 primary
  + up to 9 additional).
- **Services / Products:** Edit profile → **Services** (and the **Products** tab) —
  add items with names + short descriptions.
- **Description:** Edit profile → **Description** (≤750 chars; no phone/URL/promo per
  Google rules — weave terms in naturally).
- ⚠️ **Do NOT** stuff a city/keyword into the **business name** — it violates Google's
  naming policy and risks suspension. Geo belongs in the description + address.

---

## 1. Shared across ALL outlets — categories & menu

"near me" / category / menu terms resolve by the searcher's location, so every
outlet competes locally for the same set. Apply these identically at all four.

### Categories (the single strongest relevance lever)
Wins: `cafe near me` (22.6k clicks), `coffee near me` (11.5k), `coffee shop near me`,
`coffee`, `cafe`, `cafes near me`, `breakfast near me`, `dessert near me`.

- [ ] **Primary category → `Cafe`**
- [ ] Additional → **`Coffee shop`**
- [ ] Additional → **`Espresso bar`**
- [ ] Additional → **`Breakfast restaurant`** (only if breakfast is genuinely served)
- [ ] Additional → **`Coffee store`** (only if retail beans/merch are sold)
- [ ] Additional → **`Dessert shop`** (only if desserts are a real part of the menu)
- [ ] Consider **`Brunch restaurant`** / **`Tea house`** if they fit honestly
- [ ] `restaurants near me` (3.2k clicks) → add **`Restaurant`** as additional **only**
      if full meals are served; otherwise skip — an inaccurate category dilutes
      relevance and can mis-trigger.

> Only add categories you genuinely are. Relevance is diluted, not boosted, by
> categories that don't match — and Google can flag them.

### Services / Products (wins the menu/long-tail terms)
Wins: `breakfast near me`, `dessert near me`, `latte near me`, `matcha near me`,
`brunch near me`.

- [ ] Add **Products** for signature drinks: Latte, Cappuccino, Flat White,
      **Matcha Latte**, plus your top-selling specialty drinks (name + 1-line desc + price).
- [ ] Add **breakfast / brunch items** as products or a "Breakfast" service.
- [ ] Add **dessert items** (cakes, pastries) as products.
- [ ] Keep names plain and searchable ("Iced Matcha Latte", not a cute internal name).

---

## 2. Per-outlet — geo description

Each draft weaves the outlet's place names + top category terms in naturally. These
are **starting drafts** — verify the bracketed facts and adjust tone before pasting.

### Celsius Coffee — Shah Alam
Wins: `cafe shah alam` (1.4k), `cafe seksyen 13`, `setia alam cafe`, `cafe seksyen 7`.
- [ ] Set description to (≈, ≤750 chars):
  > Celsius Coffee is a specialty coffee cafe in **Shah Alam**, serving freshly brewed
  > coffee, espresso, lattes and matcha alongside [breakfast/brunch and desserts]. A
  > relaxed spot for coffee lovers across **Setia Alam, Seksyen 7 and Seksyen 13** —
  > whether you're grabbing a quick flat white or settling in to work. [Add: signature
  > drink, dine-in/takeaway, hours highlight.]
- [ ] Confirm the address + pin are exact (drives every "near me" term out here).

### Celsius Coffee — Putrajaya
Wins: `cafe putrajaya` (948).
- [ ] Set description to (≈):
  > Celsius Coffee is a specialty coffee cafe in **Putrajaya**, serving freshly brewed
  > coffee, espresso, lattes and matcha with [breakfast/brunch and desserts]. A
  > welcoming spot for a quality cup near [Presint __ / nearby landmark]. [Add:
  > signature drink, seating/work-friendly note.]
- [ ] Confirm address + pin (and the precinct, if relevant to "cafe presint putrajaya").

### Celsius Coffee — Tamarind (Tamarind Square, Cyberjaya)
Wins: `cafe cyberjaya` (202), `cafe tamarind square`.
- [ ] Set description to (≈):
  > Celsius Coffee is a specialty coffee cafe at **Tamarind Square, Cyberjaya**,
  > serving freshly brewed coffee, espresso, lattes and matcha with [breakfast/brunch
  > and desserts]. A go-to coffee stop for Cyberjaya's students and professionals.
  > [Add: signature drink, work-friendly/seating note.]
- [ ] Confirm the listing names **Cyberjaya** and **Tamarind Square** (the two ways
      people search for it).

### Celsius Coffee — Nilai
No ads data (Nilai is effectively invisible today — 0 reviews). Relevance basics first;
this outlet's real unlock is the **reviews loop** (get the first reviews live).
- [ ] Set description to (≈):
  > Celsius Coffee is a specialty coffee cafe in **Nilai**, serving freshly brewed
  > coffee, espresso, lattes and matcha with [breakfast/brunch and desserts]. A
  > convenient coffee spot near [USIM / nearby landmark]. [Add: signature drink, hours.]
- [ ] Confirm the listing exists, is verified, and the address/pin are correct.

---

## 3. Profile completeness (all outlets) — quick relevance/quality wins
- [ ] Opening hours set (regular + holiday) — missing hours get down-ranked.
- [ ] Website / online-order / menu link added.
- [ ] Primary phone added.
- [ ] Photos: storefront, interior, menu board, 3–5 hero drinks; refresh a couple weekly.
- [ ] All four listings **verified**.

---

## 4. After applying — measure
The geogrid tracks these exact ranked terms per outlet (`GeoGridKeyword`, seeded by
the `geogrid-keywords` cron). Once `GOOGLE_PLACES_API_KEY` is set + Places API enabled
(project 23036), the weekly scan shows whether avg rank ↓ / %top-3 ↑ for the terms you
just optimised. Attribution isn't exact (it's audit → optimise → re-check, not a tight
loop), but a sustained move on the high-demand category terms is the signal the edits worked.

## What this checklist does NOT cover
- **Prominence / radius** → the **reviews loop** (already built+live). Relevance gets
  you on the board for a term; reviews push how far out you hold it.
- **Competitor-brand terms** → paid ads only (filtered out of the keyword set).
- **GBP write-back automation** → still manual; see Approach B in [[gbp-profile-optimizer]]
  if recurring upkeep proves worth automating via the Business Information API.
