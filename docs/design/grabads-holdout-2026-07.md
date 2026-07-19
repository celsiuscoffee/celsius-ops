# GrabAds pause holdout — Jul 2026

Measuring the **real incremental sales decrement** from pausing GrabAds, to
convert Grab's inflated *attributed* ROAS (Putrajaya 3.33×) into a *true*
incremental ROAS and a defensible cash number.

## What was paused, when
- **Shah Alam** (`outlet-sa`) — GrabAds paused **2026-07-15**.
- **Tamarind** (`outlet-tam`) — GrabAds paused **2026-07-15**.
- **Putrajaya** (`outlet-con`) — GrabAds paused **2026-07-16** (first *clean*
  post-pause day = **2026-07-17**; Jul 15–16 still ran with ads on).

Google Ads (separate system, `ads_campaign`) were **not** part of this — Grab only.

## Cost structure (measured, BOM-based, 30d to 2026-07-16)

| Outlet | Grab gross/mo | GrabAds/mo (Jun) | Food cost % | Contribution* | Break-even ROAS |
|---|---|---|---|---|---|
| Putrajaya | ~RM11,450 | RM2,587 | 24.1% | 45.9% | 2.18× |
| Shah Alam | ~RM13,460 | RM901 | 24.4% | 45.6% | 2.19× |
| Tamarind | ~RM8,380 | RM1,244 | 22.8% | 47.2% | 2.12× |

\*contribution on Grab gross = 1 − 30% commission − food cost (excludes
packaging, so mildly conservative). Food cost = cheapest-supplier BOM over the
actual Grab item mix (`MenuIngredient` × `SupplierProduct` ÷ package factor),
96–100% item coverage.

Pausing **adds cash** whenever the *true incremental* ROAS < break-even (~2.2×).

## Cash framework — does pausing improve cash?

The whole decision in one picture. Grab revenue is booked gross, but Grab takes
commission + ads before you see it, then COGS eats more. Worked example (COGS
~24% measured on the Grab mix):

| | **Ads ON** | **Ads OFF** |
|---|---|---|
| Revenue | 10,000 | 6,000 |
| − Grab commission 30% | −3,000 | −1,800 |
| − Grab ads (~23% / 0) | −2,300 | 0 |
| − COGS ~24% | −2,400 | −1,440 |
| **= Cash** | **~2,300** | **~2,760** |

**Ads OFF wins by ~RM460 even though revenue fell RM4,000.** If the ad load runs
heavier (e.g. 30%+) or COGS is higher, ads-ON flips **negative** while ads-OFF
stays positive — the gap only widens.

Why: the extra RM4,000 of revenue the ad bought cost `1,200 commission + 960
COGS + 2,300 ad = RM4,460` to earn RM4,000 → that incremental block **loses
cash**. Cutting it keeps the money.

**Break-even rule (one line):**

> Cash improves whenever the ad's true ROAS < **1 ÷ (1 − commission − COGS) ≈ 2.2×**
> (30% commission + 24% COGS → 46% contribution → break-even 2.17×).

Equivalently: `net cash from pausing = ad spend − incremental revenue × contribution`,
and `incremental revenue = ROAS × ad spend`, so it all reduces to the ROAS-vs-2.2×
test. In the worked example the implied ROAS is `4,000 ÷ 2,300 = 1.74×` → below
2.2× → pausing wins.

**The holdout measures the one unknown:** how much revenue *actually* falls when
ads go off (= how incremental the ad was, i.e. the "10k → 6k" drop). Below ~2.2×
ROAS → pausing improves cash. Use **actual billed** ad spend (not the daily-budget
cap) for the ad line — Grab only bills for ads it delivers (e.g. Shah Alam's RM50/day
budget billed only ~RM30/day).

## Locked pre-pause baseline (Jun 17 – Jul 14, day-of-week matched)

Avg Grab gross by weekday (RM):

| Outlet | Mon | Tue | Wed | Thu | Fri | Sat | Sun | Daily avg |
|---|---|---|---|---|---|---|---|---|
| Putrajaya | 279 | 325 | 344 | 502 | 317 | 405 | 376 | 364 |
| Shah Alam | 381 | 344 | 561 | 526 | 459 | 576 | 424 | 467 |
| Tamarind | 261 | 358 | 281 | 283 | 253 | 329 | 264 | 290 |

Demand control (pre-pause): Grab share of (Grab + till pos) — Putrajaya **12.0%**,
Shah Alam **17.7%**, Tamarind **13.2%**. If Grab share falls post-pause while till
holds, the drop is ad-driven; if share holds, it's general demand.

## Read schedule
- First look **2026-07-23** (1 week), solid read **2026-07-30** (≥2 of each weekday).
- **Ignore the first 1–2 days per outlet** — residual ad delivery + settlement lag.

## Progress log

### 2026-07-19 — early read (full days Jul 15–17; Jul 18 partial)
Baseline switched to the **median** per weekday (the mean Wed was inflated by a
Jul 8 outlier: RM890 / 23 orders). Grab vs median baseline, with till as the
demand control:

| Outlet | Jul 15 Wed | Jul 16 Thu | Jul 17 Fri | Till (control) | Signal |
|---|---|---|---|---|---|
| **Tamarind** | −26% | +18% | +27% | volatile, no dir. | flat/up → ad non-incremental |
| **Putrajaya**\* | −27% | +86% | −14% | held | small drop (1 clean day) |
| **Shah Alam** | −48% | −54% | −31% | held | down, but NOT ad-caused |

\*Putrajaya paused Jul 16; Jul 15–16 still ran with ads on (Jul 16 = +86%), so
Jul 17 is its only clean day. Jul 18 (Sat) is partial (order counts 3–6) — not
readable.

**Findings:**
- **Tamarind** — Grab held/rose with ads off → the ad was doing ~nothing → near
  the full-savings ceiling.
- **Putrajaya** — one clean day −14% while till +6% → small real drop, still
  strongly cash-positive.
- **Shah Alam** — Grab down ~30–54% while **till held**, but the ad is only
  RM30–50/day (billed ~RM30) and **cannot** drive a ~RM200/day drop (that's a
  6–7× ROAS). So the drop is **Grab-channel softness, not the ad** — flag as an
  operational check (store availability / rating / ranking), separate from the
  ad decision. Earlier "−RM2,300 loss" call was an artifact of the outlier
  baseline + over-attribution; **retracted**.

**Refreshed projection (up from the initial ~RM1,700/mo, because the ads look
LESS incremental than first assumed):**

| Outlet | Ad saved/mo (billed) | Net cash/mo |
|---|---|---|
| Tamarind | RM1,244 | +RM1,000 – 1,244 |
| Putrajaya | RM2,587 | +RM1,500 – 2,000 |
| Shah Alam | RM901 | +RM500 – 900 |
| **Total** | **RM4,732** | **≈ RM3,000 – 4,100/mo** |

**Central ≈ RM3,500/mo (~RM42k/yr).** Floor ~RM2,500 (if ads had ~1.5× pull);
ceiling RM4,732 (ads fully wasted, where Tamarind already sits). Firms up at the
Jul 23 / 30 read.

## How to read it (per outlet)
1. `decrement/day = baseline(weekday) − actual Grab gross`.
2. `incremental ROAS = (monthly decrement) ÷ (monthly GrabAds spend)`.
3. `net cash gain from pausing = ad spend − decrement × contribution`.
4. Cross-check the demand control: is post-pause Grab **share** below baseline?
   If not, discount the decrement (market effect, not the ad).

Expected (projection, central case): pausing adds **~RM1,700/mo (~RM20k/yr)**
combined; Shah Alam + Tamarind are confident (~RM1,150/mo); Putrajaya is the
swing (~+RM550/mo, but could go slightly negative if its ads are >~68%
incremental — which is exactly what this holdout resolves).

## Read query (Supabase project kqdcdhpnyuwrxqhbuyfl)
```sql
WITH daily AS (
  SELECT o."loyaltyOutletId" oid, po.created_at::date dt,
         to_char(po.created_at,'Dy') dow, SUM(po.total)/100.0 grab
  FROM pos_orders po JOIN "Outlet" o ON o."loyaltyOutletId"=po.outlet_id
  WHERE po.source='grabfood' AND po.status='completed'
    AND o."loyaltyOutletId" IN ('outlet-con','outlet-sa','outlet-tam')
    AND po.created_at::date >= date '2026-06-17'
  GROUP BY 1,2,3
),
base AS (  -- pre-pause weekday baseline
  SELECT oid, dow, AVG(grab) avg_base
  FROM daily WHERE dt BETWEEN date '2026-06-17' AND date '2026-07-14'
  GROUP BY 1,2
)
SELECT d.oid, d.dt, d.dow,
       ROUND(d.grab,2) actual_grab,
       ROUND(b.avg_base,2) baseline,
       ROUND(d.grab - b.avg_base,2) decrement,          -- negative = below baseline
       ROUND(100.0*(d.grab-b.avg_base)/b.avg_base,1) pct_vs_base
FROM daily d JOIN base b ON b.oid=d.oid AND b.dow=d.dow
WHERE d.dt >= date '2026-07-15'   -- post-pause (con: use >= 07-17)
ORDER BY d.oid, d.dt;
```
Sum `decrement` over the post-pause window (skip each outlet's first 1–2 days),
scale to a month, then: `incremental ROAS = monthly decrement ÷ monthly spend`
and `net cash = spend − decrement × contribution`. Cross-check the demand
control by pulling `channel='pos'` (till) from `unified_sales` for the same days
— the decrement only counts as ad-driven if Grab share dropped while till held.

## Notes / caveats
- **No ad-on control outlet** — all three coffee outlets paused within a day, so
  a fleet-wide Grab swing can't be differentiated except via the till control.
- Putrajaya Grab order-level data only starts 2026-06-17 (POS cutover), so the
  baseline window is anchored there for all three (comparability).
- Grab's *attributed* ROAS (dashboard) counts repeat regulars; this holdout
  measures the *incremental* truth. 49% new / 47% repeat / 4% reactivated.
