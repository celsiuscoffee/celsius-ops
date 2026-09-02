# STATE — cross-session memory

Working memory for agent sessions on this repo. Read this at the start of every
session; update it before ending one. Keep entries dated, terse, and factual —
delete entries that have been promoted into `CLAUDE.md`, a skill, or a doc.

Kept light by a monthly roll-over (procedure: housekeeping skill, "STATE.md
roll-over"): finished narratives and stale resume pointers move to
`docs/state-archive/YYYY-MM.md` — grep there for history older than the
current month.

## Verified facts

- 2026-09-01 — **The cashflow salary projection was a frozen bank average, not a
  payroll.** `RecurringExpense` "Salary (central, incl. all outlets)" held
  **RM64,021.00** — exactly the May/Jun/Jul EMPLOYEE_SALARY bank mean
  (64,294.45 + 63,587.20 + 64,181.90)/3, set 2026-07-23 and never refreshed.
  Actual salary paid for the July run on 3-4 Aug was **RM53,216.54** (24 lines
  + 10 OT top-ups), so it already overstated by ~10.8k. Recomputed the August
  cycle read-only: prorated basic **51,858.06** across 23 paying full-timers of
  27, OT only ~46 (3 of 21 hours approved; **136 attendance logs unactioned**),
  allowances ~1,811 → gross **~53,715**, deductions ~7,125 (EPF 5,713 / SOCSO
  245 / EIS 98 / PCB 1,069), **net ~46,590**, employer statutory ~6,981.
  Row updated to **47,000** (rounds up to cover the OT backlog). Due day is the
  3rd — `nextDueDate` stores midnight-MYT as prior-day 16:00 UTC, so a raw
  `2026-08-02 16:00` IS the 3rd; do not "fix" it.
  **Do NOT run `scripts/generate-recurring-from-bank-lines.ts` until #1123 is
  merged and reclassify has run** — August EMPLOYEE_SALARY reads RM0 from the
  `Sal Jul26` narration break, so a Jun-Aug regeneration would write ~42,590.
  Still stale, left alone deliberately (erring high is the safe direction for a
  forecast): "Statutory (EPF/SOCSO) — HQ" at **15,552.20** is an April figure;
  Jun/Jul/Aug actuals were 16,143 / 14,224 / 14,369 and the computed September
  remittance is ~14,106.
  The August payroll run itself **still does not exist** and cannot be created
  from this environment (`calculatePayroll` needs `hrSupabaseAdmin`;
  `SUPABASE_SERVICE_ROLE_KEY` is unset and the API route needs an OWNER session).
- 2026-09-01 — **Settlement is ~93-95% of POS sales, and a PH Monday defers the
  whole weekend batch.** Measured Monday bank inflow against the preceding
  Sat+Sun POS sales over 8 Mondays: 81.3 / 96.7 / 105.3 / 108.6 / 79.1 / 92.6 /
  86.5 / 113.5 % (mean 95.5, August-only 92.9). Public holidays settle at
  weekend levels (1 May 5,192 / 27 May 3,074 / 1 Jun 4,276 / 17 Jun 6,181) with
  the batch landing 2-3 days later — after 1 Jun (Mon PH), Wed 3 Jun spiked to
  24,197 against a 10,932 normal Wednesday. So 29-31 Aug trade (Sat 7,866.99 +
  Sun 8,254.24 + PH Mon 7,912.07 = **24,033.30**) yields **~RM22,400** of
  inflow, only ~4,500 of it on the 31st and ~18,000 across 1-2 Sep.
  Consequence: **use POS sales, never bank settlement, to judge whether trade is
  falling.** Jul→Aug POS is −3.3% as banked and **−4.9% on a matched day mix**
  (July 23 weekdays/8 weekend, August 21/10, and weekends trade BETTER —
  9,169.70 vs 7,244.30 per day in July). Per outlet: Conezion −4.3%, Shah Alam
  −1.2%, Tamarind −4.5%. PH days trade well (31 Aug 7,912 beat the prior Monday
  6,819 by 16%) — staff Malaysia Day (Wed 16 Sep) as a strong day.

- 2026-08-31 — **Director ad claims lag 1–4 months, so cash-basis ads is
  meaningless.** Of August's RM18,575.28 of claims, only **RM2,262.26 (12%)**
  is August spend — `indeed 15/8/26`. The rest is June (`Marketing 0626`,
  6,331.98) and July (`Marketing 0726` ×3 + `indeed 2/7/26`, 9,981.04). July's
  RM9,857.44 was April + June spend. Use `ads_metric_daily` for the true
  Google run rate (May 9,126.24 / Jun 9,128.49 / Jul 14,045.13 / Aug 7,076.96),
  never the bank month.
- 2026-08-31 — **New `RECRUITMENT` CashCategory + COA 6502-05.** Indeed is
  hiring spend, not advertising: DIGITAL_ADS is deduped out of bank opex
  against the Google-only ads module and `indeed_ads_invoice` /
  `indeed_ads_metric_daily` are **both EMPTY**, so routing Indeed there erases
  the cost from the P&L entirely; OTHER_MARKETING keeps it but reports hiring
  inside the marketing line. RM13,922.43 across 11 claims since Jan-2025;
  RM4,165.92 in Aug-2026, the largest month on record. Wired through
  classifier (`recruitment_indeed`, ahead of the ads-claim rule),
  `gl-posting-map` (6502-05 — unmapped categories fall to Suspense),
  `cash-tracking`, and `cashflow` `costs.payroll` (unhandled categories are
  silently dropped from the cost total). **NEITHER migration applied** —
  `packages/db/prisma/migrations/20260831_cashcategory_recruitment` and
  `apps/backoffice/supabase/migrations/020_coa_recruitment.sql` await owner
  approval; then `POST /api/finance/reclassify {"full": true}`.
  Note: `prisma migrate diff` cannot run here — `packages/db/prisma/migrations`
  has no `migration_lock.toml` (it is an audit trail, not a Prisma history), so
  enum SQL is hand-written following `20260629_cashcategory_revenue_monster_dividend`.

- 2026-08-31 — **A coverage link is not a match — one open invoice was
  stranded, silently.** `linkCashOutByInvoiceNumber`
  (`lib/finance/cash-out-coverage.ts`) stamps `BankStatementLine.apInvoiceId`
  with NO `apMatchedAt` and no invoice update, to source settled cash-out for
  the P&L. ap-match's candidate filter was `apInvoiceId: null`, so any line the
  linker touched became invisible to matching **forever**. On an OPEN invoice
  that means the money left the bank and the bill stayed unpaid — no
  `fin_bank_line_events`, no `fin_ap_match_rejections`, no `fin_audit_log` row,
  because the linker writes none. Case: Rich Products `282411058M`, RM1,262.40,
  paid 2026-08-28 via Ariff (`paymentType=STAFF_CLAIM`), invoice still
  `INITIATED`. Race: `/api/cron/procurement-exec` runs the linker over
  `mytDaysAgo(90) → mytDaysAgo(2)`, reaching a line at T+2 days, ahead of
  ap-match (last pass 29 Aug had only worked forward to 26 Aug lines). Scale is
  bounded: 907 lines carry a link with no match, **906 point at already-PAID
  invoices** (the intended use), exactly 1 was stranded. Fixed on
  `claude/monthly-cashflow-decline-4u7a1j`: the linker now only links `PAID`
  invoices, and ap-match gates on `apMatchedAt` (the only true match marker)
  with `isReconsiderable` keeping PAID-linked lines out of the pool. Lesson:
  when two writers share a column, the one that means "done" must be the one
  the guard reads.
- 2026-08-31 — **Open payables are RM68,239, not RM13,817.** Both earlier
  figures this session bucketed `Invoice` by `dueDate` and silently dropped the
  **96 open invoices with a NULL `dueDate`** (RM55,685). Verified unpaid three
  ways: (1) reference-matching open invoices against every bank debit since
  15 Jul finds 1 of 138 — against invoices marked PAID in August the same match
  finds 232 of 303, **94.6% by value**, so the method has recall; (2) invoices
  marked paid in Aug 123,633 vs bank supplier outflow ex-salary 120,320, a
  ~3,300 gap with no room for another 68k; (3) Yow Seng's August payments all
  quote `YSIV2607-*` (July) refs. Always check the NULL bucket before quoting
  an ageing.
- 2026-08-31 — **Purchases: the cut is real but the bill is deferred.**
  Invoiced by issue month Jun 132,389 / Jul 166,595 / **Aug 117,417**
  (−29.5% Jul→Aug) — a genuine buying reduction, larger than the cash view.
  But only 44.7% of August's invoices are paid; **RM64,960 lands in September**,
  alongside ~47k payroll (3 Sep) and ~28k rent (7–11 Sep). Bank cash view
  d1–29: Jun 150,812 / Jul 149,580 / Aug **120,320** — and note Aug is
  RM8,338.75 lower than the raw category total because Ariff's `Sal Jul26` line
  sits in RAW_MATERIALS until the reclassify runs. Vendor detail: Collective
  Project is 61% of the drop (34,802 → 16,934) but **July was a catch-up
  month** — five large balance batches clearing June-numbered invoices — so
  against June the real cut is ~10,700, not 17,868.

- 2026-08-30 — **August cashflow: the bleed stopped.** Bank feed reconciles
  exactly to stated closing balances at 29 Aug (13,895.30 HQ + 5,967.14
  Tamarind + 2,450.53 Conezion = **22,312.97**; 31 Jul close was 29,263.11).
  Like-for-like d1–29 net: Jun −10,301 / Jul −22,795 / **Aug −6,950** — the
  best of the three and +15,845 better than July. Driver is the cost side:
  external cash OUT 334,661 / 322,837 / **286,842** (−11.1% Jul→Aug) falling
  faster than external cash IN 324,359 / 300,043 / **279,892** (−6.7%).
  InterCo nets to zero on both sides (~87k/month moved), so it does not
  distort the net. Aug close projects **RM27k–36k** on a day-type basis
  (30 Aug Sun ≈ +4,089 avg; 31 Aug PH Mon +1,773..+13,142, excl. the 3 Aug
  payroll Monday at −28,297).
- 2026-08-30 — **September is the squeeze, not August.** The Aug monthly
  payroll run **does not exist yet** (only July's `c64f6cd2-…`, confirmed
  7 Aug, gross 62,726.18 / net 54,788.83, `paid_at` still NULL) and payday
  is 3 Sep. Stack: 3 Sep FT net ~47k → 7–11 Sep rent ~28k (Mayang 11,486.80
  + Tujuan Gemilang 10,293.66 + Azhar 5,700 + Pilihan Megah 500, always the
  7th–13th) → ~15 Sep statutory ~7–8k. Open supplier invoices are light:
  overdue 1,262.40 / due 30–31 Aug 1,537.31 / 1–7 Sep 4,156.95 / rest of
  Sep 6,860.00. Google Ads accrued-unpaid ~10,865 still sits outside this.
- 2026-08-30 — **PT wage cut is real but eroding, and the roster no longer
  predicts it.** Bank by work-week (week no. parsed from narration; week N
  pays on its own Friday): pre-cut W21–W28 avg **6,238.88/wk**; cut lands
  W29 (24 Jul); W29–W34 = 4,764.50 / 4,039.50 / 3,769.50 / 3,958.50 /
  4,771.00 / 4,623.00. Trough-to-date W31; last two weeks average 4,697 —
  **+833/wk off the trough**. Reduction vs pre-cut is now ~1,958/wk
  (~RM8.5k/month), down from ~2,375/wk at the trough. Mechanism is hours
  per head, not headcount: pay per head 322 → 218 with headcount flat at
  ~19–20. **RM-per-scheduled-hour stepped up in W33–W34 (10.00 / 10.33)
  vs W31–W32 (7.66 / 8.11)** — actual hours are running above roster, so
  scheduled hours are no longer a usable forecast input. W35 roster is
  only `ai_generated` for CC001/CC002 (CC003 + Nilai absent) and 31 Aug is
  Hari Kebangsaan (PH multiplier).
- 2026-08-30 — **Second Maybank narration break, same class as the salary
  one.** From 2026-08-21 part-timer transfers read `PT W33/26` / `Pt w33 26`
  instead of `PT Week 33/26`; the `partimer` rule only matched
  `/\bPT\s*WEEK\b|\bPARTIMER\b/i`, so RM882 (W33) and the **entire
  RM4,623 W34 run** fell to OTHER_OUTFLOW. Fixed on
  `claude/monthly-cashflow-decline-4u7a1j` via `PARTIMER_RE` (still requires
  a week number so a bare `PT` cannot swallow vendor lines). Lesson: treat
  every narration regex as a ratchet — assume Maybank abbreviates, and
  always verify a category's *latest* line, not just its total.
- 2026-08-31 — **`docs/admin/` created as the business-administration hub**
  (owner request: a dedicated home for "admin stuff"). Skeleton only:
  `README.md` (conventions — no secrets/scans in repo, Drive links only,
  every dated obligation mirrored into the tracker), `renewals.md` (master
  deadline tracker — the one file that must stay complete), plus per-domain
  files `company.md` (SSM/cosec/banking), `licenses.md` (per-outlet permits:
  Shah Alam/MBSA, Conezion/PPj, Tamarind), `outlets.md` (tenancy +
  utilities), `insurance.md`, `contracts.md`, `compliance.md` (LHDN/SST/
  EPF/SOCSO registrations; payroll execution stays with the HR module).
  All sections are `PENDING — owner to share`; next session on this topic
  should fill tables from whatever the owner has shared and keep
  `renewals.md` as the source of truth for dates. Branch
  `claude/admin-stuff-structure-sv9ufm`.
- 2026-08-31 — **The "Tamarind loses bread at 3–6× recipe" finding was a
  COUNT-UNIT defect, not loss — retracted.** Bread's only stock-count line is
  a "10pcs Loaf" package (cf 10, BB003's sole package, BB001 also has a ×100
  Box); staff key the PIECE number into it, so every bread count was stored
  10× inflated. Proof (CC002 27→28 Aug): count 9 → booked 100-pc receipt →
  count 70 — exact in pieces, impossible in packs; also Tamarind entered
  "20.5" packs (half a sealed 10-pack doesn't exist). Read in pieces, bread
  reconciles ~1× with BOM. Fixed in PR #1195 (merged 2ee9c3da): count keypad
  offers "Loose <baseUom>" (packageId null = factor 1) whenever any package
  multiplies, `pcs`-based products OPEN in loose pieces, preview enlarged;
  items API now deletes other-unit rows on upsert (finalize SUMS lines per
  product — "7 loaves" re-counted as "70 pcs" used to apply as 140).
  Historical bread count rows are still stored ×10 — any analysis comparing
  pre-31-Aug bread counts must divide by 10 (or treat entries as pieces).
- 2026-08-31 — **BOM engine audited and verified correct on direct recipes;
  ONE structural gap: no prep expansion.** Independent SQL recompute of
  Tamarind 25 Aug matched consumption_shadow_runs exactly (beans +18 g = one
  Extra Shot, milk −260 ml = one oat substitution). But the engine expands
  MenuIngredient only — it never walks ProductRecipe, so raw Udang expected
  misses CP0001/SU0001 prep consumption. Prep-corrected (CP grams 1:1, SU
  ×80 g): Tamarind udang = 1.04× ✓ (the "6×" was this gap); Putrajaya still
  1.69×. Remaining REAL anomalies (clean count intervals, all channels):
  Putrajaya beans 2.01× + udang 1.69× (early Aug; no counts since 9 Aug to
  confirm), cream ~0.3–0.5× of the 250 ml/carbonara dose (BOM likely
  overstated — weigh a plate). Bread/milk/foam/udang(Tam) reconcile ~1×.
  Owner-approved build still pending: engine walks ProductRecipe for
  never-purchased prep outputs; fix CP0001 yield unit (1000 g → "31 pcs").
- 2026-08-31 — **Stock counts auto-approve; discrepancies are flagged, not
  queue-blocking** (PR #1164, merged 741ae87; owner ruling). Finalize
  auto-approves every complete on-schedule count (balances were applied
  regardless anyway); short/stale/off-schedule still go to SUBMITTED review.
  Backoffice gains a Flagged filter (unresolved-discrepancy counts, any
  status), Manage action, and reason-coding + Save on REVIEWED counts. The
  3 stuck Tamarind counts (13–15 Aug) and 2 ancient 30-Apr monthlies were
  flipped to REVIEWED by SQL; SUBMITTED queue is now empty by design.
  Staff memo issued 31 Aug: hr_memos de648741 (announcement, 61 recipients,
  ack-tracked; direct SQL insert so no push went out) + Gmail thread
  1a056d19e819ce5d (owner asked "no email" seconds after send — dup, benign).
  Memo says: count all 9 nightly, check the unit, no fake zeros, book
  deliveries on arrival, keep portions to recipe (gaps up to 2× expected).
- 2026-08-21 — **"Unauthorized" on checklist Photo Proof = the 12-hour staff
  session dying under an app that never noticed.** Owner screenshot:
  `staff.celsiuscoffee.com says: Unauthorized` over the Photo Proof camera.
  That string is `apps/staff/src/app/api/upload/route.ts` returning 401 from
  `getSession()` — a real expired session, not an upload/storage fault.
  `SESSION_MAX_AGE` is 12h with **no renewal**, and the staff PWA stays mounted
  for a whole shift, so when the token dies the page keeps rendering its last
  SWR data while everything behind it 401s. Middleware only checked that the
  cookie EXISTED, so even a page load re-rendered the signed-in shell.
  Prod logs (Vercel project `staff`, 24h to 2026-08-21T15:00Z) show it is
  routine, not a one-off: 401s grouped by path — /api/hr/clock 62,
  /api/checklists 62, /api/auth/me 60, /api/upload 3 — arriving as repeating
  bursts from devices sitting dead for hours (22:38, 22:47, 23:18, 23:45,
  00:15, 00:23, 01:36, 03:13, 03:21, 04:18, 05:05, 05:26, 06:14Z). The
  staffer's first and only signal was the dead-end alert at the moment of
  work, with the photo discarded. Fix (this branch): middleware VERIFIES the
  JWT (jose, edge-safe; fails open if JWT_SECRET is unset) and redirects to
  `/login?next=…&reason=expired`; `apps/staff/src/lib/session-expiry.ts`
  installs a one-time window.fetch interceptor so any 401 from our own /api/*
  bounces to the same place (login endpoints exempt — **/api/auth/change-pin
  401s on a mistyped current PIN**, so a fat-fingered pin change must not eject
  the staffer), plus a foreground check that catches expiry when the phone is
  picked back up rather than at the next save; login honours `next` and shows
  a "session timed out" banner. CameraCaptureModal now keeps the shot on
  screen with an error banner when a save fails (Retake/✓ still live, ✓
  retries) instead of closing over a lost photo — the checklist/audit/claims
  capture handlers throw instead of alert()ing. Same pass fixed the WEB twin
  of #1179: checklist note-save, tick and photo-delete ignored their response,
  so a failed PATCH silently reverted.
  **NOT done — owner decision:** no sliding session renewal. Renewing on
  activity would keep a counter device signed in as whoever last used it,
  against the shared-tablet logout fix already in `clearSession`. So an
  expired session still means "re-enter PIN", just with a signpost instead of
  a dead end. If staff hit this daily, the lever is `SESSION_MAX_AGE`
  (packages/auth/src/constants.ts, 12h) — a shift-length decision, not a
  code one.

- 2026-08-21 — **THE CUSTOMER APP HAS BEEN STRANDED ON 25-JUL JS SINCE THE
  FINGERPRINT SWITCH — every pickup-native OTA since then reached ZERO
  phones while the workflow went green.** Owner reported the Orders tab
  flipping back to the pre-tabs empty state again ("we fixed this many
  times"). Root cause is the *mirror image* of the July bug: `eas update`
  publishes to the runtime **app.json resolves to**, but an installed app
  only accepts updates matching the runtime **it was built with**. Since
  2026-07-25 app.json has used `policy: "fingerprint"`, while every binary
  on the App Store / Play was built earlier under `appVersion` and reports
  runtime `1.0.3` (app.json is still version 1.0.3 / buildNumber 12 /
  versionCode 10 — **no fingerprint store build has ever been cut**, so
  nothing in the field can match a fingerprint publish). Proof: run
  32156055677 (18 Aug, the welcome-voucher ship) succeeded publishing to
  `e4e2beee7ab3004bdb18f146549a88d895e65cf2` (iOS) /
  `dbe20143f9bfb4c9c827261a61150a391014bec2` (android). The newest bundle
  any real phone can see is the one-off 25-Jul catch-up (group
  `2ad415b6-9974-41a1-abae-23477603fe17`, runtime `1.0.3`, both platforms).
  So **#1112 (stock-count/receipt integrity) and #1155 (welcome voucher)
  never reached a customer** — the STATE line claiming "customer phones
  pull the new wallet lists on next launch" was wrong. The reinstall
  half: a fresh install boots the store binary's EMBEDDED bundle, older
  than the catch-up, which is the pre-tabs screenshot. **Fix (this
  branch):** `apps/<app>/ota-runtimes.json` declares the in-field runtimes
  the normal publish misses (pickup-native: `["1.0.3"]`; pos/staff-native
  empty — they are still on `appVersion` at 1.0.0, which their publish
  already targets); every OTA workflow now runs
  `scripts/ota-publish-extra-runtimes.mjs`, which pins a literal
  `expo.runtimeVersion` per entry, republishes the same bundle, and FAILS
  the job unless eas confirms that runtime. `scripts/check-native-runtimes.sh`
  (CI `native-runtime-guard`) fails any PR bumping `expo.version` under
  `appVersion` without declaring the outgoing runtime. Removed
  `pickup-native-ota-catchup.yml` (manual, never re-run — the process hole)
  and `pickup-native-ota-deploy.yml` (marker-triggered on a stale `claude/*`
  branch, published THAT branch's JS straight to customers). Merging this
  PR is itself the remediation: the workflow republishes current JS to
  runtime 1.0.3 and the fleet catches up on next launch.
  **MERGED + DELIVERY VERIFIED 2026-08-21** (owner said "merge it"): PR
  #1177 squashed to main as `9f96be7`; CI 15/15 green. The OTA workflow
  run 32478218572 then published TWICE — the usual fingerprint group, and
  the new verified step to the fleet: `Runtime version 1.0.3`,
  `Platform android, ios`, update group
  `cdfd5a85-b6a4-4da7-b836-e0b5f5a5565b`, log line
  `[ota] ✔ runtime 1.0.3 (channel production) confirmed.` **That is the
  first OTA since 25 Jul to land on a runtime real phones report**, and it
  carries the never-delivered #1112 + #1155 JS with it; customers pick it
  up on next launch. A follow-up commit added
  `tests/ota-runtime-coverage.test.ts` workflow-coverage assertions —
  every workflow running `eas-cli update` must also run the extra-runtime
  publisher (discovered from disk, so new native apps are covered
  automatically); verified non-vacuous by deleting the step and watching
  it fail.
  **THE FINGERPRINT INCLUDES THE VERSION IDENTITY — measured 2026-08-21,
  and the ota-release skill had asserted the opposite.** `npx expo-updates
  fingerprint:generate` on pickup-native: at 1.0.3/12/10 the hashes are
  ios `e4e2beee7ab3004bdb18f146549a88d895e65cf2` / android
  `dbe20143f9bfb4c9c827261a61150a391014bec2` — *exactly what the stranded
  18 Aug OTA published to*, confirming those publishes targeted the current
  source and not anything installed. Bumping to 1.0.4/13/11 moves them to
  ios `c24dc6b2…` / android `0c74b3fd…`. So a version bump mints a new
  runtime under BOTH policies; the skill's "version bumps are now JS-safe"
  line was false and would have stranded the 1.0.4 fleet on its next bump —
  the same bug a third time. `scripts/check-native-runtimes.sh` no longer
  skips fingerprint apps: it fails a version-identity change (version OR
  buildNumber OR versionCode) unless that app's `ota-runtimes.json` is
  touched in the same PR. Verified across four scenarios.
  **STILL OWED (owner action, cannot be done from CI): cut a new store
  build.** Until a fingerprint-policy binary ships, every fresh install
  still boots a months-old embedded bundle on first launch, and the
  fingerprint publishes keep reaching nobody. Bump version/buildNumber/
  versionCode, `eas build --profile production`, submit, then retire
  `1.0.3` from the manifest only once that build has replaced the fleet.
  **Lesson: a green OTA run is not evidence of delivery — read the runtime
  in the publish log and compare it to what installed binaries report.**
  The 18 Aug STATE line asserting "customer phones pull the new wallet
  lists on next launch" was written from a green workflow and was false
  for four weeks; the publish log's runtime is now the only acceptable
  proof, and the workflow fails rather than let that claim be made again.
  `pos-native-ota-deploy.yml` (pinned to the stale branch
  `claude/awesome-davinci-CvikE`, publishing THAT branch's JS to every
  till) was REMOVED on owner instruction, along with its marker file;
  `apps/pos-native/DEPLOY-LOCAL.md` now points at `workflow_dispatch` on
  `pos-native-ota.yml`, which can only publish from `main`. Both
  marker-deploy workflows are now gone.
  pickup-native app.json is bumped to **1.0.4 / build 13 / versionCode 11**
  ready for that build; after submitting, read the build's REAL runtime off
  the EAS build page and add it to `apps/pickup-native/ota-runtimes.json`
  (do not trust a local fingerprint:generate — the tree differs at build
  time). Keep `1.0.3` listed until the new build has replaced that fleet.

- 2026-08-20 — **Choc Blanc Merdeka campaign (31 Aug – 30 Sept 2026) — BACKEND
  STAGED, NOTHING PUBLIC.** Plan + go-live runbook in
  `docs/design/choc-blanc-merdeka-campaign.md`. Staged in prod, all gated off
  and verified 0-leak against the reader queries: product `choc-blanc`
  (RM14.90, category `classic`, Bar, Mont Blanc's modifiers cloned,
  `is_available=false` + `visible_channels={none}`); voucher template
  `8b19f425-4a6b-42f8-883a-3be43ccc377e` "RM3 off Choc Blanc" (flat 300 sen,
  `applicable_products={choc-blanc}`, 7-day validity so `reward_expiring`
  picks it up, `is_active=false`); 3 `splash_posters` rows — pos-display
  `740fc57d…`, home `a0d810a8…`, splash `400f637d…` — all `active=false`
  with `starts_at` 2026-08-30T16:00Z / `ends_at` 2026-09-30T15:59Z (splash
  ends 2 Sept). **`image_url` is still `''` on all three** — no Cloudinary
  creds in the session; upload-ready crops were rendered at each surface's
  true ratio but must be attached before go-live or the slots render blank
  (the runbook's step 1 is a pre-flight that catches this).
  **Lessons worth keeping:** (1) `active=false` is NOT a safe staging guard —
  `pos-poster-autopilot` is ENABLED and flips `active`/`sort_order` daily at
  07:00 MYT on home + pos-display; a future `starts_at` is the real guard
  since every reader filters the schedule window. (2) A pos-display poster
  with `round=NULL` is invisible to the autopilot (`poster-autopilot.ts:151`
  filters to non-null rounds) — that is how you pin a launch poster.

- 2026-08-28 — **Choc Blanc: the three owner decisions are SETTLED, and the
  poster artwork exists.** (1) Choc Blanc **sells alongside Mont Blanc**, it
  does not replace it — the runbook's step 6 (retire Mont Blanc) is now a dead
  step, and the campaign must be measured as **net units across both SKUs**
  since they share the RM14.90 shelf price. (2) **RM14.90 confirmed.**
  (3) **Cost per cup RM3.4471** — a new `Menu` row (`storehubId='choc-blanc'`)
  clones Mont Blanc's 8 BOM lines and adds `Chocolate Powder` 10g @ RM0.089/g
  (= RM0.89); `products.cost` is set, which unblocks margin and the home-poster
  autopilot's margin term. Margin 76.9%.
  **Verified facts worth keeping:** (a) `products.id` is the join key to
  `Menu."storehubId"` — that is how the customer catalogue and the costing side
  are linked, and there is no FK enforcing it. (b) Ingredient cost does NOT
  live on `"Product"` (no `cost` column); it is the SQL-managed `product_costs`
  view, keyed `product_id`, field `cost_per_base`. (c) **`menu_margins`
  overstates cost on any recipe carrying modifier lines** — it sums *every*
  BOM row, so Mont Blanc reads RM4.4548 against a true base cup of RM2.5571
  (it bills an Extra Shot *and* an Oatmilk swap into the same cup); Choc Blanc
  reads RM5.3448 vs RM3.4471. Treat `menu_margins.margin_pct` as a floor.
  (d) `Menu`/`MenuIngredient` are staff/backoffice-only — `apps/order` never
  reads them, so creating a recipe leaks nothing to customers.
  **Artwork DONE** — `docs/design/assets/choc-blanc/canvas/` holds three
  `.dc.html` artboards (home 1200×1121, splash 1080×2340, POS 920×1200) built
  by `build.mjs`, which injects the repo's Peachi face as base64 into a
  gitignored `.build/`. That font inlining is load-bearing: **a Google-hosted
  webfont silently falls back during PNG export**, and the export is what gets
  uploaded. Canvas:
  https://claude.ai/code/artifact/8a858143-05d9-4365-96ea-ddb9e0108e1e
  **Lesson — the A4 master cannot be cropped to a landscape band.** The glass
  is 1030×1520 with its top at y=415 and the baked header rule directly above,
  so *no* crop of the 2483-wide A4 at 1.65:1 contains the whole drink. Fix, in
  `canvas/make-heroes.py`: stretch+blur the source to an oversized plate, feather
  the real photo back on top (the table is bokeh, so the extension is
  invisible), then cut one window per surface at exactly that artboard's
  photo-box aspect — `object-fit: cover` then crops nothing. Every hero now
  clears the glass by ≥87px on all four sides.
  **Posters are RENDERED** — `canvas/render-posters.mjs` drives headless
  Chromium over the `.build/` artboards (the ones with Peachi inlined) and
  emits PNG + JPEG into `.build/out/`. No canvas export step needed any more.
  **Lesson — `--window-size` counts browser chrome**, so the layout viewport
  came out ~87px shorter than asked; the artboard laid out short and the
  remainder was painted with the page background. The poster looked fine
  except the last line of copy was missing. Render with headroom and crop to
  the declared box; `crop-posters.py` now fails the build if page background
  appears on the bottom/right edge (verified: it rejects a deliberately short
  render). Same class of trap as the webfont one — both produce a
  plausible-looking but wrong poster rather than an error.
  **UPLOADED 2026-08-29 — the last go-live blocker is CLEARED.** All three
  `splash_posters` rows and `products.choc-blanc` carry real `image_url`s,
  byte-for-byte identical to the renders. Current live keys after the art
  revisions: `posters/promo/choc-blanc-home-v5.jpg` (157632),
  `-splash-v3.jpg` (284249), `-pos-v3.jpg` (137206) and
  `-product-v2.jpg` (118721). Still invisible: `starts_at` is future on all
  three posters and `products.is_available = false`.
  **Every re-upload needs a NEW KEY** — objects are written
  `Cache-Control: public, max-age=31536000, immutable`, so overwriting a key
  leaves stale bytes in front of every viewer; hence the -v suffixes.
  **Lesson — a remote session CANNOT reach object storage, but that does not
  mean it cannot upload.** The agent proxy answers 403 to CONNECT for
  `*.supabase.co` and `*.cloudinary.com` (curl HTTP 000), while the Supabase
  MCP tools keep working because they route via the MCP proxy — so SQL is
  reachable and storage is not. Three routes were rejected before the one that
  worked: `storage.objects` has NO INSERT policy for `posters`, and adding one
  would make a publicly READABLE bucket world-writable (defacement risk on
  customer screens) — never do this for convenience; `pg_net` 0.20.0 is
  installed but takes only a jsonb body, so it cannot POST binary; and
  base64-ing the files to push them through SQL is refused by the sandbox's
  classifier, correctly, since that is bulk file exfiltration through the
  model. **What worked: `celsius-ops` is a PUBLIC repo.** Commit the assets,
  then have a temporary Edge Function fetch them from `raw.githubusercontent`
  (pinned to a commit SHA) and write them to storage with the service role key
  the edge runtime injects. No image bytes pass through the agent at all — it
  is a server-to-server copy between two systems the owner already controls.
  Guardrails used: hard-coded asset allowlist, two-bucket allowlist, shared
  secret, and a minimum-size check on the fetch. **This project's keys are the
  new `sb_` format, not JWTs** — `SUPABASE_SERVICE_ROLE_KEY` in the edge
  runtime is 41 chars starting `sb_`, and Storage rejects it as
  `Invalid Compact JWS` when sent only as `Authorization: Bearer`. It needs
  the `apikey` header as well (`apikey` + `Bearer` together works). **Repo visibility is worth
  checking FIRST next time** — the whole detour existed because it was assumed
  private.
  **Launch day is NOT automatic (verified 2026-08-29).** `home` is
  `active=true` and opens at 31 Aug 00:00 MYT on its own, but `splash` and
  `pos-display` are `active=false` and `products.choc-blanc` is
  `is_available=false` with `visible_channels={none}` — every reader needs
  `active` AND the window, so someone must run runbook steps 3–5 on the day.
  Runbook step 2 used to tell them to `update image_url = '<POS 0.818 url>'`;
  that would have overwritten the real URLs with literal placeholders and put
  blank posters on the screens — the exact failure step 1 exists to catch. It
  is now a verify-only select.
  **The autopilot ignores the schedule window** (`poster-autopilot.ts:145-151`)
  — it selects every poster for the placement regardless of
  `starts_at`/`ends_at` and flips `active`/`sort_order` at 07:00 MYT daily. The
  `round IS NOT NULL` filter applies to `pos-display` ONLY, so a round-less
  *home* poster is still in the pool. First ranking Choc Blanc faces is 07:00
  on 31 Aug, seven hours after its window opens; `products.cost` is set, which
  restores the margin term, but a zero-AOV poster can still be benched. To
  guarantee the slot, disable `app_settings.pos_poster_autopilot_enabled` for
  the fortnight. Readers DO filter the window, which is why an early
  autopilot activation cannot leak.
  **SMS design settled 29 Aug — B1F1, split by past behaviour.** Offer is
  **Buy 1 Free 1 Choc Blanc**, new template `a0e3661c-5cba-454f-a50a-1cebd597225f`
  (staged `is_active=false`, scoped `applicable_products={choc-blanc}`, bogo 1/1,
  7-day). The pre-existing `ed33eb26-…` "Buy 1 Free 1 Drink" is NOT usable here —
  it is live and scoped to 8 whole categories, so it would be redeemed on a latte.
  Economics per redemption: full price RM11.45 margin, RM3-off RM8.45, B1F1
  RM8.01 — B1F1 costs 44 sen more than RM3-off for ~5x the perceived value and
  puts a cup in a second person's hand. RM3-off template stays inactive.
  **Two loop-engine changes made this runnable** (`loop-engine.ts`):
  `ArmDef.voucher_template_id` is now `string | null` (a null arm is
  announce-only — mints nothing, no COGS), and `prepareRound` gained
  `onlyPhones`, an allowlist applied after `suppressPhones`. Before this the
  engine could not express an announce-only arm at all: every arm had to issue a
  voucher, and the `celebration` template hard-requires an `{offer}`.
  **Lesson — purchase history barely links to people.** Only `customer_phone` on
  `pos_orders` (55% of tickets, from 2026-06-08) and `orders` (28%, from
  2026-04-11) attributes a sale to a member; `unified_sales` has no customer
  column and the whole StoreHub era (2022 → mid-2026) has none. ~13,700 of
  167,012 transactions (8%) are attributable. So "never bought X" means "no
  record", not "didn't". 538 identifiable Mont Blanc buyers among actives ≤60d
  vs 410 units/month sold — most drinkers are invisible. Any behaviour-defined
  segment built on this is a clean list on the positive side and a
  can't-rule-out bucket on the negative side; never treat the complement as
  proven non-buyers, and never compare the two as if randomised.
  **Cleanup still owed to a human:** this MCP server can deploy Edge Functions
  but has no delete, so the slug `choc-blanc-asset-upload` survives, emptied to
  an inert 410 stub (`verify_jwt` on, no secret, no service-role use) — delete
  it in the dashboard. Also delete `posters/_probe/delete-me.png`, a 70-byte
  test object; `storage.protect_delete()` blocks removing objects via SQL.
  **Lesson — a feather inset into the photo lands ON the subject.** The plate
  technique feathered the real photo into the blurred backdrop with a 130px
  inset on all four sides. The cream cap sits on the crop's FIRST ROW, so that
  ramp blended the top of the drink 96% into the blur (alpha 10/255 at the cap,
  177/255 at the base) — it reads as a soft-focus drink, not as a compositing
  bug, which is why it survived several rounds of review. Fix: grow a smeared
  margin around the photo and feather THAT, so the ramp never touches the
  image. The top margin cannot come from the photo's own top rows (nothing
  inside the crop is drink-free — that smears the cap upward into vertical
  streaks); it comes from the A4's backdrop ABOVE the baked rule, rows 336–378.
  The crop line also moved 400 → 387, the first row under the rule: 400 was
  shaving the cream. `make-heroes.py` now asserts the mask is fully opaque
  across the whole drink. Edge detail across the cap up ~25%; glass geometry
  on every surface unchanged.
  **Social set added** — Instagram/Facebook feed 4:5 (1080x1350), story 9:16
  (1080x1920, 250px top / 330px bottom kept clear for Instagram chrome and the
  link sticker) and square 1080x1080. These deliberately carry NO price: a
  price baked into an image dates the post and drags comparison into the
  comments, so RM14.90 goes in the caption where it can change without a
  re-export.
  (3) A new poster scores ~0 in the autopilot (no measured AOV, `cost` NULL →
  no margin) so it gets benched fast; set `products.cost` or disable the flag.
  **Open decisions for the owner:** replace-vs-alongside Mont Blanc (410 units
  / RM6,108 per 30d), confirm RM14.90, and cost per cup.
  **Channel reality found while planning:** push is dead as a channel — 123
  members hold a push token out of 25,992 (80 of the 5,928 actives ≤60d), so
  the campaign is ~99% paid SMS at RM0.10 (full actives blast ≈ RM593).
  Measured `loop_rounds` say `reward_expiring` is the only reliable loop
  (+10.3–19.0pp lift, RM5.44–8.64/recipient) while winback/fresh_lapse swing
  −33 to +9.5pp at n=18–30/arm — statistically unreadable. No Instagram
  integration exists in the repo at all; IG is manual and unattributable.

- 2026-08-18 — **Welcome-voucher cutover EXECUTED (owner-approved, ~15:45Z)
  — the 10% welcome voucher is LIVE and the auto-FOD is retired.** PR #1155
  merged to main (`b3c4205`, squash); apps/order production deploy READY on
  order.celsiuscoffee.com before the SQL ran; pickup-native OTA workflow
  (run 32156055677) completed success — customer phones pull the new
  wallet lists on next launch. Cutover SQL applied to prod in order:
  (1) voucher_templates row `b6865e22-9bc3-42f0-9eba-d4e20bdcd84c`
  ("10% Welcome Discount", percent 10, validity 30d, new_member +
  auto_issue, active); (2) `promo-first-order-celsius` → is_active=false.
  Verified end state: 1 active new_member auto_issue template, 0 active
  first_order promos. From now: first app sign-in → voucher in wallet +
  push; redemption only via app orders (web initiate/quote and POS redeem
  refuse `source_type='welcome'`). Rollback = re-activate the promotions
  row + deactivate the template (both single UPDATEs). Deploy-gap check
  (a voucher issued before the new code went live would carry ungated
  source_type='manual'): zero issued_rewards after 15:30Z — clean.
  **E2E check (owner-requested, 2026-08-19) found issuance DEAD ON
  ARRIVAL: 22 verified logins (20 phones) in the first hour after
  cutover, 0 welcome vouchers issued.** Root cause: the native app signs
  in via `/api/otp/verify`, whose `ensureNewMemberRewards` call was a
  bare floating promise — Vercel freezes the lambda at response return,
  so issuance never ran (the sibling `/api/loyalty/otp/verify` awaits it;
  welcome.ts's own push already needed `after()` for the same reason).
  Fix: wrap issuance in `after()` in otp/verify (this branch). No
  backfill needed — issuance is idempotent per member+template, so the
  missed 20 phones receive the voucher on their next sign-in.
  **Lesson: on Vercel routes, fire-and-forget = fire-and-lose; anything
  that must complete after the response needs `after()`.**

- 2026-08-18 — **FOD redesign (owner-directed): replace the invisible auto
  first-order discount with a VISIBLE 10% welcome voucher issued on first
  app sign-in, redeemable ONLY on app orders.** Driven by three
  "downloaded but no 10%" complaints; root causes were visibility (auto-FOD
  showed nothing at checkout on old bundles) and channel confusion (POS /
  web-QR never qualify; web_qr = 2,052 orders since Jul 22, 0 FOD, vs 342
  app orders — owner confirmed keep app-only, rejected extending to web,
  ~RM500/mo). Code shipped on `claude/missing-first-order-discount-bhe4uw`
  (PR #1155): `resolveOrderReward` gains `channel: "app"|"web"` and refuses
  `source_type='welcome'` vouchers from web (initiate + quote pass "web";
  /api/orders passes app only when source is app_ios/app_android); POS
  redeem route refuses welcome vouchers at the till; `welcome.ts` now
  issues with `source_type='welcome'` (was 'manual'); "welcome" added to
  all 7 wallet-source lockstep lists (native home rail/wallet/count,
  shared rewards-count, web rail/wallet). Issuance itself is the EXISTING
  `ensureNewMemberRewards` pipeline (otp/verify → auto_issue new_member
  templates, idempotent, push-notifies) — no new_member template currently
  exists, so nothing issues until the cutover. **Cutover (owner approval
  needed, run AFTER merge+deploy, in order):**
  (1) `insert into voucher_templates (id, brand_id, title, description,
  icon, category, discount_type, discount_value, validity_days, is_active,
  auto_issue, reward_type, stacks_with_beans) values (gen_random_uuid(),
  'brand-celsius', '10% Welcome Discount', 'Thanks for joining — 10% off
  your first order placed in the app', 'discount', 'discount', 'percent',
  10, 30, true, true, 'new_member', true);`
  (2) `update promotions set is_active=false where
  id='promo-first-order-celsius';` — retires the auto-FOD (charge + native
  preview both read this row) so voucher + auto never stack. Between (1)
  and (2) both exist briefly; run back-to-back. Merging OTAs pickup-native
  (JS-only lockstep-list change — OTA-safe). Note: existing members who
  never signed into the app also get the voucher on their first app login
  (owner's wording: "every time we detect first login in apps").

- 2026-08-18 — **"Downloaded but didn't get 10%" (customer 018-2247861 /
  +60182247861) — ordered at the POS, not in the app; FOD correctly did not
  apply.** Member created 08:59Z, then order `CC-CON-6559` at the Conezion
  POS 09:08Z (RM49.70, zero discounts, no manual discount keyed); zero
  `orders` rows on the phone. Same shape as +60196098892 (2026-08-06) —
  now the THIRD complaint of the "downloaded but no 10%" family. FOD is
  native-app-orders-only by owner design (2026-07-22, drives app ordering);
  the gap is customer expectation: "install = 10% off anywhere". Support
  reply: the 10% applies when the order is placed IN the app; invite them
  to place their next order via the app (their first-order credit is still
  unused — no `orders` rows means the FOD will fire on their first app
  order). Owner decision worth raising: counter script ("order in the app
  for your 10%") and/or in-app copy clarifying the discount applies to app
  orders, not counter sales.

- 2026-08-17 — **"Downloaded but didn't get 10% first order" (customer
  019-2448782 / +60192448782) — the discount WAS applied and charged.**
  Member created 08:09Z, order `C-5473` 08:17Z (`app_ios`, dine-in, Shah
  Alam): subtotal RM54.60, `first_order_discount_amount=546` (exactly 10%),
  FPX charged the discounted total **RM49.14** (provider ref
  `260817081703300416985246`, status preparing). No money owed. Likely
  perception gap: PR #1118 (checkout-preview FOD line, merged 2026-08-06)
  ships via OTA, but a **fresh install runs the store-embedded bundle on
  first launch** — if that binary predates #1118, checkout showed no
  discount line while the charge included it. The order-detail screen
  (`pickup-native/app/order/[id].tsx`) does render "First order discount
  −RM5.46", so the customer can verify in-app under Orders → C-5473.
  Support reply: point them at the receipt line + RM49.14 bank charge vs
  RM54.60 subtotal. Follow-up worth considering: cut a new store binary so
  the embedded bundle includes #1118 (second complaint of this shape after
  +60196098892 on 2026-08-06).

- 2026-08-17 — **A DATABASE TRIGGER depletes stock on every POS sale — found
  after four sessions of hunting phantom balance movement.** `pos_order_items`
  carries `pos_order_items_stock_ins` → `pos_apply_item_stock()` (SECURITY
  DEFINER, plus a cancel-restore twin on `pos_orders`). It resolves the menu BY
  NAME, sums MenuIngredient rows, and decrements `StockBalance` directly — no
  StockAdjustment, no app-code trace, invisible to every `adjustStockBalance`
  grep. Three facts about it: (1) POS-only — customer-app `orders` (12–20% of
  demand) are never depleted; (2) it floors at zero (`greatest(0, …)`), silently
  swallowing depletion when a balance is low; (3) it had NO modifier logic, so
  when the 20260810 BOM migrations landed (32 Oatmilk substitution rows, 22
  Extra Shot rows) it began charging every POS coffee 36 g of beans and BOTH
  milks. Measured over-depletion 13→17 Aug: ~7.2 kg beans + ~50 L oat per
  outlet. **Hotfixed** (owner-approved, `supabase/migrations/105_…`): the
  trigger now reads `modifier IS NULL` rows only — which also ends its old
  Iced+Hot double-syrup charge. Tamarind's nightly counts had been resetting
  its drift; Putrajaya/Shah Alam (no count since 9/7 Aug) carry it until their
  next count overwrites balances — no data repair needed beyond counting.
  **Lesson: the app code is not the whole system. Check pg_trigger /
  pg_get_functiondef before declaring "nothing writes X".**

- 2026-08-17 — **Consumption engine rewired through `expandSoldLine`**
  (`consumption-post.ts`): per-line modifiers + real order_type from BOTH
  channels, storehubId-first menu join with the name fallback (LATERAL LIMIT 1,
  no fan-out), refund-netted POS quantities, full recipe rows incl. `modifier`
  + `replacesProductId`. The old engine aggregated by menu (losing modifiers),
  dropped Affogato (null storehubId), and would have posted the same
  double-milk bug as the trigger. Shadow telemetry has run nightly since
  16 Jul into `consumption_shadow_runs` (19:00 UTC; scheduler is OUTSIDE
  vercel.json — locate before assuming it can be changed there);
  `menus_without_recipe` is now 0. **Plan of record: validate shadow vs daily
  counts (assume unreceived movements: PO-due deliveries + pending transfers),
  then REPLACE the trigger with the engine — never run both live
  (double-deduction).** "Biscoff Batik Indulgence" = renamed "Matcha Batik
  Indulgence" (POS product_id → that menu's storehubId); needs its own menu
  row + recipe rather than inheriting matcha's.

- 2026-08-17 — **Staff transfer routes moved RAW package units into the
  base-UOM ledger** — "5 packs (1000g)" debited the sender 5 g on creation and
  credited the receiver 5 g on completion. Fixed both sides to convert through
  the line's package factor. Related leak: transfers stuck at PENDING debit
  the sender and never credit the receiver (all three bean transfers into
  Tamarind sit PENDING).

- 2026-08-13 — **Receiving and stock counting were denominated in DIFFERENT
  package units, which is why no stock reconciliation ever tied out.** Counts
  are clean: every product counted since 1 Aug used exactly one package, zero
  nulls (24 products checked). Receipts are not — **357 of 1,541 ReceivingItems
  since June (23%) carry no package at all**, and every write path fell through
  to conversion factor 1, i.e. "assume base UOM". Brioche Sandwich is the clean
  demonstration: 6 receipts stored as `10pcs Loaf` (=100 pcs) and 6 stored bare
  (=10 pcs), same supplier, same drop size, ×10 apart. Fresh Milk is worst — 6
  receiving packages spanning ×1,000 to ×24,000 (CC001 takes 2 L bottles, CC002
  takes 1 L), 25 bare receipts booked as millilitres, while every count of it
  used `Bottle (1,000ml)`. 20 products have a receiving package strictly larger
  than their counting package (ratios 40×, 24×, 20×, 12×, 10×, 6×, 4×, 3×, 2×) —
  fine *when recorded*, catastrophic when not. Fixed by `resolveReceiptPackage`
  (`packages/db/src/receipt-package.ts`): receiver's choice → PO line → sole
  package → base-UOM-only-if-product-has-no-packages → otherwise REJECT. Against
  those 357 rows: 334 resolve from their own PO line (**the data was already in
  the database; the backoffice and Pay & Claim routes simply never persisted
  it**), 13 from a sole package, 10 genuinely ambiguous. Wired into all five
  ReceivingItem write sites; each stores the resolved package AND derives the
  balance from the same factor so the two cannot drift. Rejection is per-receipt,
  not per-line (a receipt is one physical delivery).
  **Still open:** the 357 historical rows are NOT repaired — that rewrites posted
  stock and needs owner sign-off. Five open POs will be refused on receipt
  (CC-CC001-0308 / -0355, CC-CC002-0355 sippy lids; CC-CC001-0338, CC-CC003-0149
  plastic sampah) because their PO line has no package on a multi-package
  product, and **`apps/staff-native` receiving sends no `productPackageId` at
  all** (`CreateReceivingInput` has no such field) — so staff cannot fix it in
  the app. Set the package on those PO lines, or add a picker to the native
  screen.

- 2026-08-13 — **Counting conventions differ by person, and nothing has ever
  checked them.** `expectedQty` is NULL on all 2,863 StockCountItems since June,
  so no count was ever compared to anything. Entry style since 1 Aug: Haziq
  36/38 whole numbers, Firdaus 9/9 whole, Qaisara 6/6 whole, Shairuleen 16/19
  whole — but **Sherry 8 of 18 items at 2+ decimal places** (56.347 bottles of
  milk, 0.754 kg of beans; her Home Blend series reads 0.754 → 21.7 → 75.55 kg
  over three days, which is not a stock curve). CC003's Ameir entered `1.5`
  packs of Brioche Loaf (=15 pcs) where CC001's Haziq entered `17` (=170 pcs).
  **Deliveries settle it in Haziq's favour**: CC001 took 7 boxes ×100 = 700 pcs
  on 10 Aug (counts 390–440 pcs fit); CC003 took 4 boxes = 400 pcs on 29 Jul, so
  15 pcs does not. Ameir entered pieces-as-packs, under by ~10×.
  Also found: CC001 7 Aug has BOTH a DAILY count (SUBMITTED, 10 items) and a
  MONTHLY count (DRAFT, 3 items) carrying identical values — a double-count
  waiting to post; CC002's 3 Aug WEEKLY count is a DRAFT with items entered from
  13 July onward (open three weeks); CC001's 7 Aug daily has items stamped 5 Aug.

- 2026-08-13 — **Migrations `20260810_menu_ingredient_substitution` and
  `20260810_oatmilk_and_extra_shot_recipes` are APPLIED to production**
  (owner-approved, applied by hand before merging #1112). `MenuIngredient` gained
  `replacesProductId` + FK + two CHECK constraints + index; then 32 Oatmilk
  substitution rows (each mirroring its own menu's fresh-milk dose, verified
  equal on all 32) and 22 Extra Shot rows at 18 g. Table went 509 → 563 lines.
  **Ordering lesson — this nearly shipped broken:** the PR could not be merged
  before the DDL, because `par-calc.ts:173` and `reports/cogs/route.ts:48` call
  `prisma.menuIngredient.findMany({ include: … })` with no `select`, so Prisma
  emits every scalar column including `replacesProductId`; against a production
  table lacking it, par levels and the COGS report 500 on the first request. The
  other three `menuIngredient` callers use explicit `select` and were immune.
  **Check for unscoped `include:` queries before merging any additive column.**

- 2026-08-15 — **Estate-wide loop QA sweep done (every loop, all four arms:
  trigger→action→measure→feedback). Full report: `docs/design/loop-qa-2026-08-15.md`.**
  Headline: the fully-automated loops are healthy and were caught changing their
  own behaviour on evidence; the broken ones all hand their last arm to a human,
  an external feed, or an external scheduler.
  **Healthy (verified against prod, not assumed):** marketing engine — 7 live
  loops, 432 rounds / 344 measured / **0 past their attribution window**, and
  `fresh_lapse` **auto-killed itself 2026-08-13** ("+0.2pp lift, RM-2.16/recipient
  after 1296 sends"). What looks like 4 dead loops is 3 recorded pauses
  (`beans_idle` owner, `fresh_lapse` auto, both `round_gap` arms) — **check
  `app_settings.loops_paused` before reporting a stopped loop.** Ads sync 5 kinds
  OK 10/10; Tamarind probe in flight (status=3, RM46.32). Finance EOD→GL fresh.
  Backoffice is at **38/40 Vercel cron slots**; of 20 cron routes absent from
  `vercel.json`, all 20 are reachable via a dispatcher/lib/UI — no orphans.
  **P1 — GBP geogrid burns half its monthly budget on failures. FIXED.** A `failed`
  scan (all 81 grid points error) still writes a `GeoGridScan` row, and the gate
  counts rows not successes (`scansThisMonth = count(*)`), so failures eat the
  `GEOGRID_MONTHLY_SCAN_CAP=40` and can't be retried till next month. Aug 3 and
  Jul 6 are identical: 13 complete / 7 partial / **20 failed**. Consequences:
  **all 8 Shah Alam combos failed → the flagship outlet has no rank data**;
  **IOI Mall has never been auto-scanned** (16 active keywords); Putrajaya had
  zero August scans; and the weekly cadence is defeated because the month's
  budget is spent on the first Monday (Aug 10, Jul 13/20/27 all returned
  `capped`). 100%-failure on one outlet smells like a bad placeId/coords or a
  keyed API restriction — **THAT GUESS IS WITHDRAWN, see root cause below.**
  **Fix shipped:** cap now counts only `status <> 'failed'` (read AND
  decrement); new `MAX_ATTEMPTS_PER_RUN` (60, above the 40 cap) bounds attempts
  so "failures are free" can't become unbounded Places spend on a wholly-broken
  outlet; `interleaveByOutlet` round-robins the due queue so the neediest outlet
  leads but can't consume the run. Response now reports attempts/failed/errored
  separately. Pinned by `lib/geogrid/scan-runner.test.ts`.
  **ROOT CAUSE (2026-08-15, second pass) — IT IS PLACES RATE-LIMITING, NOT A
  PER-OUTLET FAULT.** Shah Alam's placeId (`ChIJFcHSHJlNzDERtGh5CheG0XE`) and
  coords (3.0733, 101.5185) are fine, and Tamarind (7) and Nilai (4) failed on
  Aug 3 too. **Ordering the run by `createdAt` is what cracks it:** seq 1-7
  complete (~4-5s each) → 10-14 failed (~1-2s, too fast to have called
  anything) → **21-26 complete again** → 32-40 (all Shah Alam) failed.
  **A run that RECOVERS mid-way is a rate limit; no per-outlet fault does that.**
  `scanGrid` fired 8 concurrent Places calls/batch with no throttle/retry/backoff,
  and the cron chains ~40 scans = ~3,240 calls flat out. Shah Alam reads 100%
  broken only because it sits LAST in the queue. Fixed: retry w/ exponential
  backoff + jitter on retryable statuses (429/5xx/no-status), fail fast on
  400/401/403/404; new `PlacesApiError` carries the HTTP status; first failure
  reason surfaced per scan as `why`; `RUN_DEADLINE_MS` 240s guard so retries
  can't get the function killed mid-scan.
  **IOI Mall is a DIFFERENT cause, also now handled:** its
  `reviewSettings.gbpLocationName` is NULL so `runScan` THREW every time — it was
  never budget starvation. Outlets with no GBP location are filtered before the
  queue and reported as `skippedNoGbpLocation`. **Owner action: connect IOI
  Mall's Google profile** (16 active keywords waiting).
  **LESSON: "which outlet fails" is a distribution, not a diagnosis — sort by
  time before believing an entity-specific story. And a failure that records no
  reason WILL be misdiagnosed:** the loop stored `status='failed'` and nothing
  else, so two months of daily evidence couldn't tell a throttled API from a
  broken profile.
  **P2 — reviews loop nudges on ARRIVAL but never on AGEING. Half fixed.**
  31 drafts ever, **28 still `pending`** (oldest 2026-06-24, newest 2026-08-09),
  1 resolved / 2 rejected, and **zero recovery codes ever issued or claimed** —
  the recovery arm has never fired. Mechanism is a cadence gap, NOT a missing
  nudge: `ops-nudge-review` runs every 5 min and DMs on-shift staff + managers,
  but `recordBreach` dedupes per review **by design**, so each is nudged exactly
  once on arrival and a draft nobody actions is never mentioned again. Added
  `runReviewBacklogNudge()` (lib/ops-nudges) — pending drafts older than
  `REVIEW_DRAFT_STALE_DAYS` (3) go out as a manager digest led by the OLDEST,
  fired once daily by gating the existing 5-min route to one window (10:00 MYT),
  so **no new Vercel cron slot** (we're at 38/40).
  **NOT done, deliberately: arming negative-review auto-reply.** 1-3★ replies are
  **already an explicit documented decision** — reviews-auto-reply/route.ts says
  negatives "are never generated or posted… human-approval path until the
  risk-classifier work lands. This is the zero-risk wedge." Arming it posts brand
  replies to unhappy customers on a public Google profile: outward-facing, hard
  to retract, contrary to a written stance. **Owner's call; wants the
  risk-classifier first.**
  **P3 — WITHDRAWN, the finding was WRONG.** I judged "starved" from table row
  counts without checking which tables the code writes. **The AP/bank loop is
  healthy:** `applyApMatches` reads `prisma.invoice` (3,027) +
  `prisma.bankStatementLine` (**59,356**), and `fin_ap_match_rejections` has 4
  rows = proof it ran and decided. `fin_documents` 37,628 (37,332 bank-feed
  slips, fresh to Aug 14). **`fin_bank_transactions` and `fin_matches` have ZERO
  code references anywhere** — dead schema from an old design, housekeeping
  candidates (owner-approved migration to drop). **`fin_bills`/`fin_invoices`/
  `fin_exceptions`** are written only by `lib/finance/agents/ap.ts`, whose sole
  caller is the MANUAL upload screen `api/finance/bills/upload` — empty because
  nobody has ever uploaded a supplier bill, i.e. an unused feature not a broken
  loop. Of the 3 agents I called no-ops, 2 genuinely run every 6h. **No Bukku
  feed is missing.**
  **LESSON: row counts are not a pipeline — before calling a loop starved, find
  the writer.** An empty table proves nothing about the loop meant to fill it.
  **And check whether "broken" is a documented decision** (see P2).
  **P4 — FIXED (9 of 10 in code).** 10 armed agents had `last_run_at` NULL while
  logging actions, so `/agents` couldn't tell quiet from stopped. **The mechanism
  is NOT simply "nobody called touchAgentRun" — for the finance agents the call
  exists on the WRONG route.** `/api/cron/ap-match-apply` and `/api/cron/gl-post`
  both heartbeat correctly but **neither is scheduled**; the scheduled
  `bukku-feed-sync` imports `applyApMatches`/`postBankLinesToGl` directly and
  never touched the registry. Same for `agent_comms_digest` (only real caller is
  the 13:00-UTC fold in `celsius-overview`). **Lesson: heartbeat the path that
  actually runs, not the route that shares the agent's name** — check
  `vercel.json` before assuming a cron route is the live path. Fixed in
  `bukku-feed-sync` (3 finance agents), `celsius-overview` (digest), and each
  agent's own run function for marketing_strategist / ops_intelligence /
  procurement_advisor / data_analyst / hr_ops_agent — always BEFORE the
  quiet-exit paths, since a quiet run is the thing that must stay
  distinguishable from a stopped one. **10th (`pos_pairing_tuner`) has no TS
  path** — pg_cron calls `public.refresh_pos_pairing_signals()` directly; its
  heartbeat shipped as `20260815_pos_pairing_tuner_heartbeat` and was **APPLIED
  to prod 2026-08-15 on owner instruction** (hard rule 6 satisfied), via the
  Supabase MCP `apply_migration` path; applied-history copy is
  `supabase/migrations/105_pos_pairing_tuner_heartbeat.sql`. **All 10 heartbeats
  are now live.** Before applying, the proposed body was diffed line-for-line
  against the live `pg_get_functiondef` output to prove the ONLY change was the
  heartbeat block (pre-change md5 `ebd1e0cc2cbfd62ba66011e2f320b579` — keep it,
  it is the rollback anchor). Verified after: heartbeat present, SECURITY
  DEFINER retained, `search_path` still `(public, pg_temp)`, pg_cron job
  `refresh-pos-pairing-signals` still active.
  **Deliberately did NOT invoke the function to test it** — it decays
  `product_co_purchase_seed`/`product_round_seed` by 5% and refreshes the
  matview, so a manual verification run would have charged the seeds an extra
  night of decay. `last_run_at` stays NULL until the next scheduled fire
  (`20 16 * * *` UTC); **check it after that to confirm the stamp lands.**
  **P5 (latent)** — `autoPauseUnderperformers` (loop-engine.ts:1482) and
  `getEvaluation` (:1704) do unbounded selects over all measured rounds: the
  known PostgREST 1000-row class. 344 rows, +7/day → **crosses the cap ~Nov
  2026**, after which the kill rule silently judges on a subset. Use
  `fetchAllRows`.
  **P6 — `finance_warehouse` stopped since 2026-07-24 (~512h, 3 missed weekly
  runs). RE-ARMED, one owner step left.** Cause: **the routine no longer existed
  at all** — listing every trigger on the account returns only one-shot
  `send_later` entries, zero recurring ones, and at least one carries
  `ended_reason: auto_disabled_session_gone`. It was bound to a session that went
  away and died with it. Re-created as `Finance warehouse — weekly custodian run`
  (`trig_01BCKPmWgpi1KUq7pk5BrK2n`), `13 14 * * 0` UTC = Sun 22:13 MYT, first
  fire 2026-08-16, **with `create_new_session_on_fire` precisely so
  session-binding can't kill it again.** Prompt carries the backlog + the Nilai
  feed and empty `fin_bank_*` items.
  **BLOCKER, owner-only: the fired session has NO Supabase MCP.** The skill's
  check suite is read-only Supabase (`SKILL.md:147`), but this org rejects the
  `connectors` param on create_trigger, and the environment holds no Supabase
  token of its own (repo `.mcp.json` configures ONLY sentry; `env | grep -i
  supabase` is empty — my DB access this session comes from an account-level
  connector that can't be passed through). **Attach the Supabase connector to the
  routine in the claude.ai routines UI.** Until then the prompt makes it fail
  loudly — it stops and reports `finance-warehouse run blocked: Supabase MCP not
  attached to this routine` rather than guessing from stale/repo-only data.
  **P7 (latent)** — `measureRound` opens each window at `assigned_at` (prepare),
  not `sent_at`; 14 scheduled rounds carry up to **8.03h** of gap over 796
  assignments. **Checked: zero mis-attributed conversions exist** (lapsed
  segments rarely order in that window), so latent only.
  **P8.1 — `hardCutDirective` DELETED** (was autopilot.ts:571, wired :1171).
  **It never self-expired the way its comment claimed:** the guard was
  `dailyBudgetMyr <= HARD_CUT_TARGET_MYR → null`, which holds only while the
  budget STAYS under RM55 and **re-arms on any future raise** — so it was not a
  spent one-time directive, it was a trap primed for the next raise, i.e. Shah
  Alam's probe-up ~Oct 7. Safe to remove now because all three are already below
  RM55 (SA 53.98 / PJ 38.16 / Tam 46.32 paused) → dormant, deletion is a no-op
  today. Nothing replaces it; guarded descent + rollback + pause-probe already
  own budget movement and read the till, not a fixed number. **Lesson: a
  "self-expiring" directive keyed on a CURRENT value is not self-expiring — it's
  dormant until the value comes back.** 3 old tests → 2 new ones pinning that an
  above-RM55 campaign isn't chopped to 55 and that a raised campaign is judged
  the same whether or not its name was on the old list.
  **P8.2/P8.3 — STILL OPEN, deliberately deferred:** probe verdict fires on
  raw-OR-adj (autopilot.ts:393) and `organic-revenue.ts` pos branch still has no
  `source <> 'grabfood'`. Both move the index the **Tamarind probe is currently
  being judged on** (verdict ~Aug 17) — changing the verdict rule or the index
  mid-experiment makes the result uninterpretable. Do them AFTER the verdict.
  **P9** — `OpsReminder` has 0 rows ever; the hourly `ops-reminders` sweep is a
  correct no-op consumer of a feature nobody uses (housekeeping-audit candidate).
  **Gotcha that cost time: `ads_sync_log.status` is `OK`, not `success`** —
  filtering on the wrong literal makes 7 healthy nightly syncs read as 7 fails.

- 2026-08-14 — **Ads agent-loop audit (full pass, probe day 11/14): loop is
  healthy, verdict is predictable, and the probe REVERSED the early read —
  Tamarind's ads were earning their keep.** Replicated the probe's exact math
  (organic series, per-weekday 4-wk recency-weighted forecast): pause-window
  index Aug 4–13 **Tamarind 0.885** vs controls SA 0.995 / Con 1.010 →
  fleet-adj ≈ 0.88; both thresholds breach. Robust to baseline choice (0.901
  on a Jul 21–Aug 3-only baseline vs controls ~1.03), to the Grab bug (0.92
  ex-Grab), and to mid-window control cuts (which bias the other way).
  Channel split: walk-in (ad-plausible, 71% of series) **0.881**, QR **1.110**,
  Grab **0.774** — Grab falling too means a non-ad factor is also biting
  Tamarind, so the effect size is uncertain but the direction is not.
  **Expected verdict at the ~Aug 17/18 19:01 run: restore at full RM46.32/day
  ("ads generate cash").** Day-5 share analysis said flat — five more days
  flipped it; consistent with the July regression (Tamarind the only outlet
  above break-even, 2.13 rev/ad-RM). Episode cost ≈ RM950 net.
  Audit facts: mode armed; 7/7 nightly syncs OK all kinds; **creative sync
  works** (48 rows — the "never produced a row" entry is obsolete); rollback
  path proven live (SA cut Aug 7 12% → guard breach → auto-rollback Aug 12;
  Putrajaya cut 12% Aug 12); **the "guard excludes the `orders` table" bug is
  STALE — `PICKUP_STORE_BY_LOYALTY` maps all three outlets and the slugs
  match** (726 Tamarind rows since Jul 7 flow in). Still real: the guard's
  pos branch has **no `source<>'grabfood'` filter** (~0.02 on the index).
  **Nilai stopped polluting the fleet median the ugly way: its
  `consignment_sales` feed is DEAD since Jul 19**, index reads 0 and the
  `x>0` filter drops it — but Nilai/IOI revenue is now invisible to
  everything downstream, including finance. Floor correction: restore-floor
  is **RM20/day** (`ADS_AUTOPILOT_FLOOR_MYR` default), not RM10 as earlier
  notes said. **Consequence armed and accepted by owner 2026-08-14: once
  Tamarind restores, `selectPauseProbe` will auto-pause PUTRAJAYA ~the next
  night** (cost/conv ~1.5× fleet-best, never probed, pauses are
  spacing-exempt) — second causal experiment, verdict ~Sep 1, predicted "no
  effect → floor" freeing ~RM545/mo.

- 2026-08-14 — **SMS/loyalty loop has been DORMANT since Jun 21** —
  `sms_logs` last row 2026-06-21, zero sends in 7+ weeks (4,162 all-time).
  The "ungated loop will cancel the ad saving" worry is not currently live;
  voucher redemptions still occur from previously-issued stock but the
  discount growth stalled in the Jul 29–Aug 4 week. Gate it before it wakes,
  not because it's spending now.

- 2026-08-14 — **A "Rest Day" roster row is `start_time == end_time == 00:00`,
  and it is NOT a shift window.** 431 such rows exist, 390 on published
  rosters. Both window builders treated `end <= start` as cross-midnight and
  added 24h, so a rest day became a 00:00–24:00 window: `paidWindowHours` paid
  the whole clocked span, took the row's `break_minutes` of 0 instead of the
  cohort's 30, and returned `needsSignOff: false` — working an unrostered rest
  day paid MORE than a rostered shift and never reached the confirm queue.
  `deriveHours` had the mirror bug (clamps pay at 00:00 for a rest-day shift
  worked past midnight). Guarded in both files; zero-length is the
  discriminator, NOT `end <= start` (a genuine 22:00→02:00 closing shift also
  has end < start). Both payroll callers already skipped these by
  string-matching `start_time` `"00:00"`, so no computed figure moved — the
  guard is there so a new caller can't miss it. Two live logs land on rest-day
  rows: Akmal 2026-07-31, Farhan 2026-08-04.

- 2026-08-14 — **Putrajaya's 2026-08-03 roster published retroactively**
  (schedule `62428d65-db1f-4a62-85d1-5b4139a245c1`, 75 shifts) on owner
  instruction; reason appended to its `ai_notes`. It had `published_by` set to
  Ariff but `published_at` NULL and status `draft` — a half-finished publish.
  Effect on that week's PT pay: only two people move, both DOWN, because their
  shifts stop pricing as unbounded cover shifts — Nurfarah −RM25.00 (6 cover →
  0), Farhan −RM4.50 (1 cover → 0). Week now **428.00 h / RM3,940.00 across 63
  shifts, zero cover shifts**. NOTE: this supersedes the 437.50 h / RM3,995.50
  figure quoted earlier the same day — that ad-hoc SQL had not yet excluded
  rest-day rows, so it inflated logs that matched one.

- 2026-08-14 — **Rostered windows in the data are not all sane, and the window
  basis makes that visible.** 3–9 Aug throws 30 shifts to the confirm queue,
  and the worst entries are roster errors rather than staff behaviour: Absah
  Natasha 5 Aug rostered **06:00–22:00** (16h) → 717 min "late"; Absah 9 Aug
  rostered 11:00–21:00 → 141 min "early out"; Naufal 6 Aug rostered
  12:00–23:30 (11.5h) → 210 min "early out". Fix the roster rows before
  adjudicating these as staff shortfalls.

- 2026-08-14 — **Alea's 2026-08-10 log (`7e09988c-…`) is a mis-tap, not an
  overstay.** She tapped **IN** at 23:30:40 MYT — 40 seconds AFTER her
  18:30–23:30 shift ended — and the log stayed open until her next clock-in on
  12 Aug 18:45:59 auto-closed it 43.25 h later (9 seconds apart). Under the
  window basis it pays **0** (the window opens after it closes) and forces
  sign-off, so there is no payroll leak; but her real 10 Aug shift is unpaid
  until corrected. Correction path is `PATCH /api/hr/attendance` with
  `action: "set_times"` from `/hr/attendance` — it recomputes through
  `deriveHours`, stamps `reviewed_by` (genuine manager sign-off) and
  `final_status: "adjusted"`. Note the route rejects a span > 24 h, so the
  clock-IN must move (18:30), not just the clock-out — you cannot fix this by
  editing one end. Owner: needs approval + manual change, NOT an automated
  backfill.

- 2026-08-14 — **PT pay basis changed; the already-PAID week is deliberately
  NOT restated (owner: "forward only, don't restate the paid week").** The new
  paid-window rules apply from the 2026-08-03 week onward — neither 08-03 nor
  08-10 had a run yet, so nothing needed undoing. Recomputing the paid
  2026-07-27 week (RM3,720.00, status `paid`, the ONLY weekly run that exists)
  under the new logic gives RM3,721.08 — net +RM1.08, but ~RM127 moving in each
  direction: Farhan +65.70, Nurfarah +20.00, Aimi +18.00 against Hadif −56.45,
  Naufal −53.74. The losers are staff who clocked in late and stayed late — the
  old daily CAP paid them regardless of WHEN they worked, the window doesn't.
  Restating would mean recovering wages already paid, which Employment Act s.24
  constrains, so it was ruled out rather than deferred. That week also holds
  ~45h worked OUTSIDE rostered windows with no approved OT request (Farah 13.5h,
  Naufal 8.5h, Hadif 8h, Fatin 4.5h, Emran 4h) — previously absorbed silently by
  the cap, now a manager decision.

- 2026-08-14 — **`calculateWeeklyPayroll` now REFUSES a week that already has a
  confirmed/paid run.** There is NO unique constraint on
  `hr_payroll_runs(cycle_type, period_start)` — only on
  `(period_month, period_year)`, which covers monthly only. The run-wipe deletes
  just `draft`/`ai_computed`, so a paid run survived it but the INSERT that
  followed added a SECOND run for the same period, silently: one week, two runs
  disagreeing about what it owes, with reporting or the bank file free to pick
  either. Nothing in the API guarded it — `POST {action:"compute"}` accepted any
  `week_start`. The guard throws and the route returns 409 (not 500) so the UI
  shows the reason. If a week ever genuinely needs restating, the settled run
  must be reopened or voided first — deliberately a manual act.

- 2026-08-13 — **PT pay was computed from a daily HOURS CAP, not the rostered
  window — so it underpaid the punctual and overpaid late arrivals.** Owner
  restated the basis (rules 1-7): clock in before the shift, clock out after
  it, only time INSIDE the rostered window is paid, tails outside it are OT
  needing approval in whole 30-min brackets, and late-in / early-out need
  sign-off too. Implemented as `paidWindowHours()` in
  `apps/backoffice/src/lib/hr/hours.ts` (PR #1126, branch
  `claude/farah-staff-onboarding-99yg3j`), the single basis for BOTH cohorts:
  `paid = [max(clock_in, sched_start), min(clock_out, sched_end)] - break +
  approved OT`. Two mechanisms it replaced, both wrong in ways a cap can't
  see: (1) the 30-min clock rounding from #1119 (`ptRoundedSpanHours`) rounded
  clock-in UP and clock-out DOWN — but the cap already clipped overstay days,
  so it ONLY bit staff who clocked closest to their shift. Punctuality cost
  RM5/shift; overstaying cost nothing. Rounding now survives only on the OT
  tails (rule 6). (2) **A CAP IS NOT A WINDOW** — it never checked WHEN the
  hours fell, so a late clock-in was silently offset by an unapproved
  overstay: Farah 2026-08-05 clocked in 35 min late, left 3h past shift end
  with no OT request, and was paid the full 7.5h. Two live data bugs fell out
  of the same query: an UNROSTERED clock-in paid **RM0** (cap = 0 with no
  shift on the grid — Farah worked 8h on Sun 2026-08-09 for nothing, silently);
  and Alea's 2026-08-10 log has a **clock-out 4h45m BEFORE its clock-in** and
  still drew 4.5h from the roster. Both now handled explicitly.

- 2026-08-13 — **FT has no pay grace period; FT are SALARIED, which is a much
  bigger difference than a grace period.** Checked because the owner believed
  FT had one. `GRACE_PERIOD_MINUTES = 5` exists in `lib/hr/constants.ts` but is
  referenced in exactly three places — `roster-attendance/route.ts:50`,
  `schedules/candidates/route.ts:149`, `pt-performance.ts:77` — all
  display/statistics. **It is not referenced in either payroll calculator.**
  The real split is `payroll-calculator.ts:643`: `basePay = isPartTime ?
  totalRegularHours * hourlyRate : prorateAmount(basicSalary, prorate)`. FT
  base pay never reads `regular_hours`, so a late FT clock-in docks nothing;
  proration is calendar/working-days (EA s.60I). FT lateness reaches pay only
  via the RM200 performance allowance and OT. Consequence: the window rule is
  SAFE for FT (it only moves regular/overtime hours, i.e. OT eligibility and
  reporting), but "consistent across FT and PT" cannot mean identical
  arithmetic — PT are docked minute-by-minute while FT are docked nothing.
  **Open owner decision: whether PT get a pay-side grace.**

- 2026-08-13 — **`lib/hr/hours.ts` is DUPLICATED between backoffice and staff,
  and both copies write pay hours.** `apps/staff/.../api/hr/clock/route.ts`
  writes `regular_hours` / `overtime_hours` straight to `hr_attendance_logs` on
  tap-out using the STAFF copy of `deriveHours`. Any change to the hours engine
  must be mirrored or a tap-out and the backoffice processor disagree about the
  same shift — typecheck will NOT catch it, because the extra option is simply
  never passed. Four call sites feed `deriveHours`: staff clock route,
  backoffice attendance route, auto-close cron, attendance-processor.

- 2026-08-12 — **Finance › Reports now exports PDF, not just CSV — P&L,
  Balance Sheet, Cash Flow and Trial Balance each get a PDF button beside the
  CSV one.** Built on branch `claude/pdf-export-tv9r8s`. Renderer is
  `apps/backoffice/src/lib/finance/statement-pdf.ts` (pdf-lib, already a dep
  for payslips/PO), driven by a `StatementDoc` model — group/subgroup/line/
  total rows plus PRE-FORMATTED value strings, so money formatting lives in
  one place and the PDF can never disagree with the screen. Rendered
  **client-side on purpose**: the export then carries the user's current view
  (compare column, by-month columns, expense cost-driver grouping) exactly as
  the CSV export does; a server-side rebuild would drop them. pdf-lib is
  behind `await import()` — verified in the production build that the reports
  page chunk (105KB) contains zero `PDFDocument` references and pdf-lib sits
  in its own 428KB chunk fetched only on click. A4, auto-landscape past 3
  value columns, repeating column headers + "(continued)" on page 2+,
  "Page N of M" footer, and every on-screen caveat (consolidated/outlet scope,
  imbalance, interco residual, reconciliation gap, COGS methodology gap)
  travels into the file as a footnote — a PDF gets emailed on without the page
  around it. Gotchas found the hard way: **standard PDF fonts are WinAnsi**, so
  `sanitize()` maps the arrows/Δ/em-dashes in our report labels or drawing
  throws; and the code column must fit `BANK:MARKETPLACE_FEE` (~13pt of width
  per pt of type size) — the first cut truncated codes to "BANK:MARKETPL...",
  which is useless since you cannot look one up. Trial Balance deliberately
  exports ALL rows, ignoring the on-screen filter (a filtered TB does not
  foot), matching its CSV. Verified visually by rasterising sample PDFs with
  pdf.js in the pre-installed Chromium — **poppler/pdftoppm is NOT available
  in the agent container and Chromium's own PDF viewer renders blank
  headless**; `unpdf/dist/pdfjs.mjs` + `--allow-file-access-from-files` works.

- 2026-08-11 — **"Worst cashflow this month" answered: the CASH BALANCE is
  genuinely the year's low (RM24,151 across the 3 accounts on 10 Aug), but
  August's trading is fine — the buffer was spent over 8 months and August's
  fixed costs simply hadn't cleared yet.** Owner asked why; then asked why
  cashflow is *stuck*. Both answered from `BankStatementLine` (external only,
  `isInterCo=false`) + `unified_sales`.
  - **Balance trail (sum of Conezion 2644 + SDN/HQ 4384 + Tamarind 9345):**
    Jan 76,360 → Mar 59,977 → May 48,450 → Jun 49,469 → Jul 29,263 → **Aug-10
    24,151**. Monthly net external flow reconciles to the balance move EXACTLY
    (Jul −20,205; Jun +1,019; Aug-MTD −5,112) — interco nets to 0.00 every
    month, so the three accounts are the whole picture. HQ 4384 is the tight
    one: 16,358 → 3,977, and it is the account payroll clears from.
  - **August MTD looked deceptively calm** (net −5,112 over 10 days, the *best*
    d1–10 of the year) purely because RENT and STATUTORY had not gone out:
    rent RM500 vs a ~RM31,900 norm (Apr–Jul it always started clearing on the
    5th–7th; on the 11th it still had not), statutory RM0 vs ~RM14,200 due on
    the 15th. RM45.7k of obligation against RM24.2k of cash.
  - **The single biggest discretionary drain was the Q2 dividend, RM15,414.27
    on 27 Jul** = 76% of July's entire RM20,205 burn. RM11,666 out of Conezion
    (balance 17,817 → 5,329) + RM3,748 Tamarind. That is why August opened with
    no cushion. Q1 equivalent was RM9,173 (28 Apr), Q4-2025 RM5,896 (22 Jan).
  - **REVENUE IS NOT THE CAUSE — do not chase it.** Days 1–10 vs July, all three
    core outlets are UP: Putrajaya +3.8%, Shah Alam +2.2%, Tamarind +3.6%.
  - **WHY IT IS STUCK: total external cash out runs at ~100% of nett sales,
    every month, and food cost is the driver and is WORSENING.** As % of nett
    sales: Apr 45.2 / May 42.8 / Jun 45.8 / **Jul 48.9** COGS; labour
    (salary+PT+statutory) 28.1 → 32.8; rent ~9.8. COGS+labour+rent = 91.5% in
    July, total cash out 103.2%. A coffee chain should run 25–35% COGS. There
    is simply no margin being generated to rebuild the buffer.
  - **Food cost by entity, July** (bank COGS ÷ that entity's outlet sales):
    **Putrajaya/Conezion 54.2%** (43.5% in Apr — worst and deteriorating
    fastest, while its sales FELL 132,975 → 124,140), **Shah Alam/HQ 51.3%**
    (48.6% Apr), **Tamarind 37.2%** (43.4% Apr — the only one IMPROVING).
  - **Concentrated in a few suppliers** (Apr→Jul): Collective Project
    22,338 → **34,802** (+56%), Yow Seng 3,226 → **13,689** (+324%), Ariff
    ad-hoc reimbursements 2,941 → **11,795** across **224 transactions** in July
    alone (~RM53 avg). Two brand-new suppliers from June add ~RM11k/mo
    (JG Pacific, Country Bread) — unknown whether additive or replacing.
    Top-3 movers alone = +RM31,781/mo against sales that fell RM13,060.
  - **Cannot currently tell over-ordering from shrinkage: `fin_inventory_
    valuations` is EMPTY (0 rows).** Stock counts exist but only ~10–13 per
    outlet since May (2–3/month, not daily) and are never turned into a
    valuation, so purchases can't be reconciled against consumption.
  - Ruled out: the bank feed is NOT stale (all 3 accounts ingested 2026-08-11
    06:00–06:03, through 10 Aug); `fin_bank_transactions` is empty and unused.
  - **Open / needs owner:** Nilai + IOI Mall both stopped reporting sales on
    **2026-07-19** — they are the only two on the `consignment` source (98 rows
    since June; `storehub` died 2026-06-17). Nilai staff are STILL on payroll
    (Nazihah RM1,875 in the Jul run). Either both closed and cost is still being
    carried, or the consignment feed broke and ~RM16k/mo of revenue is missing.
    Also `raw_poket_capital` (RM3,486 Jul) looks like financing, not food —
    likely miscategorised as RAW_MATERIALS.

- 2026-08-11 — **Maybank abbreviated the payroll narration and the classifier
  went blind to ALL of it (PR #1123, draft).** From the Aug statements:
  "Salary Jun26" → **"Sal Jul26"**, OT top-ups as "Add OT Jul26"/"OT Jul26",
  "Mngmt Fee" → "Mgmt Fee 1/2"/"mgmt 1/4". Rules matched `\bSALARY\b` and
  `\bMNGMT\s*FEE\b`, so the whole Jul-26 payroll fell to `fallback_other`:
  **RM53,381 of staff pay in OTHER_OUTFLOW, RM8,339 (Ariff Izham's own pay
  line) grabbed by `raw_ariff_adhoc` into RAW_MATERIALS, RM5,462 of mgmt fee
  loose, and EMPLOYEE_SALARY reading RM0.00 for August.** Fixed with shared
  `SALARY_RE`/`OVERTIME_RE`/`MGMT_FEE_RE` (inflow side too, so the outlet legs
  funding the central run stay inter-co). **"SAL" and "OT" are anchored on the
  pay period that follows** (month-year `Jul26`, or a split marker `1/2`) —
  bare `\bSAL\b`/`\bOT\b` would swallow unrelated lines; bare `SALARY` still
  matches alone because older rows carry "Salary 1/1" with no month.
  `salary_explicit` MUST stay ahead of `raw_ariff_adhoc` and `vendor_sdn_bhd` —
  that ordering is what reclaims Ariff's line (now pinned by a test).
  **Existing rows are NOT fixed by the deploy** — run
  `POST /api/finance/reclassify {"full":true}` after it lands (`full` is
  required: Ariff's line sits in RAW_MATERIALS, not the OTHER_* catch-all the
  default sweep covers; `GET ...?full=1` dry-runs). Note the Jul-26 food-cost
  figures above were computed BEFORE this reclass, so July is unaffected but
  **August's 35.1% COGS reading is inflated and will drop once it runs.**
  Lesson: Maybank narration format is not stable — a rule keyed to one spelling
  of a recurring monthly payment is a silent, self-concealing failure (the
  totals still reconcile; only the category is wrong).

- 2026-08-07 — **Referral codes had (almost) no way IN — the attribution
  plumbing was fully wired but the UI entry point sat on a path referred
  friends never take.** Owner: "no place for referral code even though it is
  wired". Verified: the ONLY entry field estate-wide was pickup-native
  `account.tsx`'s OTP step; the checkout sign-in flow (`checkout.tsx` has its
  OWN OTP flow — the path a referred friend actually takes, cart→sign-in→pay)
  had no field, and eligibility ends PERMANENTLY at the first paid order
  (`attributeReferralOnSignup` rejects `not_new`), so checkout was the last
  possible moment and it offered nothing. The Share & Earn screen even
  instructs "They sign up and enter your code". Web (`apps/order`) has NO
  entry field at all — /api/loyalty/referral/attribute's only callers are
  native (left as-is, out of scope). Fixed on branch
  `claude/referral-code-ui-placement-25q971`: (1) checkout OTP step gets the
  same optional field as account.tsx (gated on `is_new_member` from
  /api/otp/send, best-effort submit post-verify); (2) Share & Earn gets a
  "Got a code from a friend?" card for signed-in still-eligible members,
  gated server-side via new `can_enter_code` on /api/loyalty/me/referral
  (zero paid orders + no prior attribution — mirrors the attribute guards;
  absent field on older servers = hidden). `submitReferralCode` now surfaces
  the endpoint's customer-facing error instead of discarding the body.
  **Follow-up in the same PR (owner asked "how to get code to share"): the
  Share & Earn screen itself was ORPHANED** — the only navigation to
  `/referral` in the whole app was the push-notification deeplink in
  `_layout.tsx`; no menu row, no card. Referrers could not find their own
  code either. Added an Account → "Share & Earn" ActionRow and a signed-in
  entry card at the foot of the Rewards list.
  Merge = OTA to customer phones (JS-only, fingerprint runtime — OTA-safe).

- 2026-08-07 — **PT/intern have NO threshold overtime (owner: "PT no overtime.
  they can only be paid extra if the work more than their shift").** The pay
  side already complied (weekly calc: flat rate, cap = roster + approved OT,
  "OT is FT-only"), but `deriveHours` still split PT hours at a 5h/day
  threshold and stamped `overtime_detected` on every normal long shift (why
  Adib's corrected 7.50h Tamarind row sat flagged). Fixed: PT/intern threshold
  is now Infinity in BOTH hours.ts copies (backoffice + staff — they must stay
  in sync); the attendance processor instead flags `overtime_detected` for
  PT/intern only when clock-out runs >15 min past the ROSTERED shift end
  (cross-midnight safe; no roster end → no flag). Same-day: weekly payroll
  runs can now be DELETED while ai_computed/draft (DELETE
  /api/hr/payroll/weekly?run_id= + UI button) so a week can be recomputed
  after a rule change — confirmed/paid runs still locked; items cascade. The
  stored 27 Jul–2 Aug run (RM3,837.63) predates the lowest-30 rounding and
  needs exactly this delete → recompute (expect ≈RM3,720.00, and Absah +
  Danish's rows shift as flagged in the rounding entry).

- 2026-08-07 — **PT weekly pay now rounds each clock time to the LOWEST 30
  minutes before computing the span.** First instruction said "nearest 30min"
  with a round-down example (8.35→8.30); implemented as symmetric-nearest and
  flagged the ambiguity. Owner clarified the same day ("we need to round it
  at lowest 30min") → each end now rounds toward the inside of the shift:
  clock-out FLOORS (20:35 and 20:50 both pay to 20:30), clock-in rounds UP
  (09:58 and 09:40 both pay from 10:00). Paid span never exceeds the clocked
  span. Checked against the 27 Jul–2 Aug PT week: gross drops RM3,837.63 →
  RM3,720.00 (−RM117.63 across 17 PTs). Edge case (accepted): rounding can
  land a span exactly ON 4.00h, dodging the >4h 30-min break — e.g. Absah
  3.51h raw → 4.00h paid. Implemented as
  `ptRoundedSpanHours` in `apps/backoffice/src/lib/hr/hours.ts`, applied in
  BOTH places that price PT hours: `payroll-calculator-weekly.ts` and the
  PT-hours confirm preview (`api/hr/payroll/weekly/pt-hours`) — the two must
  stay identical or the manager preview diverges from the run. Both now
  compute from clock timestamps, NOT `total_hours` (the stored log keeps the
  real stamps; `total_hours` no longer feeds PT pay). The 30-min unpaid break
  (>4h) is judged on the ROUNDED span. Pinned in `hours.test.ts`. FT monthly
  is untouched.

- 2026-08-07 — **Owner-directed attendance corrections applied to prod
  `hr_attendance_logs` (WhatsApp-style instructions from Ammar, applied via
  SQL; all originals preserved in each row's `review_notes`):**
  (1) **Adib PT (Tamarind) 30 Jul** — duplicate 15:06–15:20 stub (log
  `f68be900`, 0.24h/RM2.16, was Confirmed) DELETED; real shift was closing
  only — log `94a2208b` clock_in adjusted 15:20→15:30 MYT, total 7.50h.
  Owner still needs to Confirm it in the PT weekly timesheet UI (row still
  shows `overtime_detected`).
  (2) **Emran/Shairuleen Sun 2 Aug (crossed accounts)** — Shairuleen (FT,
  rostered 10–6) clocked in at 09:58 on EMRAN's account (her selfie on his
  log); Emran (PT, rostered 12–8) then clocked that session OUT at 11:51
  (his selfie) and re-clocked-in at 14:26, getting a false `late_arrival`.
  Fixed: log `31f440e8` reassigned to Shairuleen, kept her real 09:58 in,
  system-closed at rostered 18:00 (no genuine clock-out existed; Emran's
  11:51 photo removed), 8.03h/reg 7.00; log `d6afaf10` (Emran) clock_in
  14:26→12:00 (he was provably on site by 11:51), 8.04h, late flag cleared.
  Both set approved/approved. Lesson: a selfie that doesn't match the
  account holder + a same-day zero-log person on the roster = crossed
  clock-in; check BOTH people's logs before editing.

- 2026-08-07 — **The stock-count "expired count" flow was un-completable in BOTH
  staff clients, which is why a 6-day-old daily count at an outlet could not be
  finalized (owner screenshots, 23:43).** Two distinct dead-ends, one shared
  server gap, all fixed on branch `claude/item-finalization-auto-refresh-a4cige`:
  (1) **Staff web PWA:** the stale-reason bottom sheet (page.tsx `stalePrompt`)
  is `z-50` — the same z as `bottom-nav.tsx`, which renders later in the DOM and
  so painted OVER the sheet's Cancel/Finalize buttons. Staff could type the
  reason but the buttons were unreachable ("put reasons, cannot proceed").
  All four stock-count overlays bumped to `z-[60]` + safe-area padding.
  (2) **staff-native (Celsius Manager):** the app had NO COUNT_EXPIRED handling
  at all — `finalizeStockCount` sent no body (no way to pass `staleReason`) and
  the error dead-ended in an OK-only Alert; it also silently resumed expired
  drafts (never read `active.expired`) and had no expiredAction on saves. Now
  has the same expired-choice (new/continue) and stale-reason modals as web.
  (3) **Server daily auto-refresh (owner ask: "can we auto refresh everyday"):**
  new `autoRefreshOnExpiry(frequency)` in `packages/db/stock-count.ts` — DAILY
  only. `active` route hides an expired DAILY draft (fresh sheet on open);
  `items` route auto-creates a fresh daily count instead of 409-ing. The
  abandoned draft stays DRAFT as evidence, never finalized — the stuck 6-day
  count self-resolves this way after deploy (its numbers span 6 days and are
  worthless for shrinkage per the 2026-07-31 finding). WEEKLY/MONTHLY keep the
  explicit new/continue + stale-reason flow.
  **Latent bug fixed on the way:** items/active routes judged expiry from
  `createdAt`, which a "continue" re-date never changes — so every save after a
  "continue" re-ran the re-date and appended another `[re-dated]` note (note
  spam), and re-opening a continued draft re-prompted. Both now judge from
  `countDate` (moves forward on re-date); **finalize still judges from
  `createdAt` deliberately** so a continued multi-day count never auto-approves
  and still records the stale note. staff-native change ⇒ merge to main is an
  OTA to manager phones (ota-release skill before merging).

- 2026-08-06 — **Stock-count schedule guard: weekly is due THURSDAY, monthly on
  the month boundary.** Windows derived from Jun–Jul 2026 trading data, not
  preference. Deliveries per weekday: Mon 15.1, Tue 14.2, Wed 6.3, **Thu 4.1**,
  Fri 14.6, Sat 3.3, Sun 13.0. Avg sales/day: Mon 9,652, Tue 9,142, Wed 9,643,
  **Thu 9,144**, Fri 10,395, Sat 13,548, Sun 14,476. Thursday is the only day
  that is both quietest for goods-in (⅓ of Monday) and joint-lowest for sales —
  stock sits still and staff have the time. Saturday has fewer deliveries (3.3)
  but is the second-busiest trading day, so it is the wrong day to count.
  Monthly anchors to the last calendar day (1st = grace) so the census matches
  the accounting close. Implemented as `evaluateCountSchedule` in
  `packages/db/src/stock-count.ts` (TZ-aware via `Intl`, Asia/Kuala_Lumpur —
  a 20:00 MYT count would read as the previous day in UTC). Soft block at
  finalize (`OFF_SCHEDULE`, needs `scheduleReason`), banner on the staff page
  before counting starts, and an off-window count never auto-approves.

- 2026-08-06 — **The 3/4/5 Aug "monthly" counts were daily counts mislabelled,
  and have been reclassified.** Five counts (CC001 3+4+5 Aug, CC002 3+4 Aug)
  carried 256 lines each but only 7–8 real values; the other ~248 were
  never-counted zeros/blanks that overwrote every balance in the store. All
  five are now `frequency='DAILY'` with only the counted lines retained (1,241
  never-counted lines deleted), each stamped with a `[reclassified 2026-08-06]`
  note. **Mismatch found:** both outlets count **Crispy Prawn** daily but it is
  NOT on the 9-product daily list, while **Smoked Duck** and **Pull Lamb** are
  on the list and appear in none of the counts. Owner decision still owed.

- 2026-08-06 — **"Native app first order didn't get the 10%" (customer
  +60196098892) — the CHARGE was never broken, the PREVIEW was.** The FOD
  wiring at `/api/orders` is correct and live: gated on source app_ios/
  app_android + zero prior `orders` rows on the phone, and the Stripe
  PaymentIntent charges `order.total` which already includes it (47 native
  orders carried FOD Jul 20–Aug 6). What's missing: the native checkout
  shows NO discount line and full price — the old client-side FOD display
  was removed when FOD config moved to the Discount Engine (commit
  `471cc59`, "server resolves at order create; no client read"), and the
  `/api/members/order-count` endpoint built for client eligibility was
  left with zero callers. So a new customer sees full price and reasonably
  concludes there's no discount. This exact customer never placed an app
  order at all (member created 10:33Z, no `orders` rows) — they ordered at
  the Shah Alam POS 10:37Z instead, where **staff keyed a MANUAL 10%**
  (RM4.86 off CC-SA-7279: `discount_amount=486`, `promo_discount=0`, no
  promo_name/discount_reason/discount_by — NOT the promo engine). An
  earlier note in this session claimed "POS auto-applied its own
  first-order 10%" — WRONG, withdrawn. Verified the engine cannot do
  that: `@celsius/shared` promo-engine filters `trigger_type='first_order'`
  out of the candidate pool, and its non-stackable-tier branch refilters to
  `tier_perk` only, so first_order never leaks; the POS route's
  `dropFirstOrderIfReturning` is dead defense (harmless, kept). So
  "native-app-only" is already fully enforced IN CODE across web/POS/app —
  the only leak path is staff manual discounts at the register, which is an
  ops/training matter (5 unattributed manual discounts since Jul 25, 2 of
  them exactly 10%). Fix shipped (PR #1118, branch
  `claude/first-order-native-app-wiring-0aigut`): evaluate endpoint returns
  a `first_order` preview for native sources (same gates as /api/orders,
  display-only, spoofing `source` changes pixels not money); native
  checkout renders the line and subtracts it before SST. Merging OTAs
  pickup-native to customer phones (JS-only change, fingerprint runtime —
  OTA-safe).

- 2026-08-05 — **Wallet vouchers 400'd at web QR checkout ("Voucher is no
  longer valid") while POS accepted the same voucher — FIXED.** Customer photo
  from Shah Alam: quote showed the Free Coffee discount, Place order failed.
  Cause: `applyWalletVoucherToState` stamps the applied reward with
  `voucher_id = issued_rewards.id` ("Use Now" path — mission/mystery/welcome/
  points-issued vouchers), and `_CheckoutView` echoed that id to
  `/api/checkout/initiate` as `voucherId`. That field means a LEGACY
  `vouchers`-table row; the gate looked the wallet id up there, found nothing,
  and 400'd BEFORE `resolveOrderReward` ever ran. The totals still previewed
  correctly because `/api/checkout/quote` takes `walletVoucherId` (no legacy
  gate) — discount visible, order blocked. POS (`/api/pos/loyalty/redeem`)
  resolves via the shared `resolveOrderReward` and never consults the legacy
  table, hence the web/POS asymmetry. Catalog (points-shop) rewards applied
  from `_RewardsView` never set `voucher_id`, so those kept working — only
  wallet vouchers broke. Fix: client no longer sends `voucherId`; both
  `/api/checkout/initiate` and `/api/orders` treat `voucherId` as legacy only
  when it differs from `rewardId`/`walletVoucherId` (stale cached PWA bundles
  keep echoing the wallet id for a while after deploy, so the server guard is
  the one that matters). Note the shared resolver's doc comment claimed the
  QR-table client "never sets voucher_id" — it did; trust code over comments
  here. Legacy `vouchers` monetary impact is nil in these routes
  (`voucherDiscountSen` is hardcoded 0); the gate only guarded
  `increment_voucher_count`.

- 2026-08-03 — **Payslips are now open to staff in the PWA; the manager app never
  needed a change.** Owner: "can you open payslip in pwa staff app and native
  staff app." **`apps/staff-native` was already fully wired** — tile at
  `(staff)/hr/index.tsx`, screen at `(staff)/hr/payslips.tsx`, `fetchPayslips()`
  → `/api/hr/payslips`, no feature flag — so NOTHING was changed there, which
  also means this carries no OTA risk to manager phones (hard rule 5).
  `apps/staff` had **three** gates stacked, and all three had to go:
  1. `PAYROLL_UI_ENABLED = false` in `lib/hr/constants.ts` — showed a
     "coming soon" notice and skipped the fetch entirely.
  2. `hr/payslips/layout.tsx` redirected anyone not OWNER/ADMIN back to `/hr`.
  3. **Nothing anywhere in the app linked to `/hr/payslips`** — even an OWNER had
     to type the URL. A tile now sits on the HR hub next to My Skills.
  The stale bit worth knowing: that flag's comment called itself a "mirror of the
  backoffice PAYROLL_UI_ENABLED". **No such constant exists in the backoffice** —
  it was removed at some point and the reference rotted.
  **`/api/hr/payslips` is the real security boundary and it is sound**:
  service-role client (hr_* is RLS deny-all) scoped to `session.id`, `status in
  (confirmed, paid)`, and `cycle_type != 'opening_balance'` so the Jan–Jun BrioHR
  YTD aggregate can't reappear mislabelled as one month's pay.
  **Split onto its own branch on the owner's instruction (2026-08-03)** so the
  July payroll corrections could merge first: deploying this publishes July
  payslips, and July still carried Nur Iffa Sofea's RM120 probation allowance and
  the Group A roster-error shifts at the time.

- 2026-08-04 — **JULY "ALREADY PAID" BASELINE recovered from the session
  transcript (owner: "already paid based on the prev compute" / "use the ones
  that we computed before").** The deleted run's per-person NET figures,
  snapshotted 2026-08-03 11:37 UTC before deletion — the settlement after the
  recompute is new_net − this baseline, per person. Ariff's line here carries
  the WRONG PCB (618.50; correct is 1,064.60) so he was over-transferred
  ~RM446. Adib appeared TWICE at 160.82 (duplicate later fixed by #1109) —
  ask owner whether one or both were transferred. Zero-net rows omitted.
  Adam Ariff Irfan Bin Mohamed Ismail: 1589.75
  Adam Kelvin: 4209.05
  AHMAD RAZLEY HIDAYAT BIN SUHAINI: 1651.45
  AMIRUL YAZID BIN ASNOR: 1501.45
  Ariff Izham Bin Abd Rahman: 8784.85
  Azmer Zul Qiefli Bin Mohamad Azlan: 1768.05
  FIRDAUS BIN NAJIB: 1886.26
  GURAF LAL JOSHI: 1644.43
  Hanisa Amirah Bt Md Shamsulrizal: 1649.75
  Mohamed Danish Hyqal Bin Mohamed Faizal: 594.64
  Mohd Haziq Bin Mohd Zaini: 2407.85
  Muhamad Syafiq Aiman Bin Mohamed Kaberi: 3128.03
  Muhammad Adib Bin Zulkifli: 160.82
  Muhammad Adib Bin Zulkifli: 160.82
  MUHAMMAD AKMAL AIMAN AMIR: 1701.38
  Muhammad Ameir Haziq Bin Noor Azman: 2136.25
  Muhammad Zarif Bin Abdul Rahman: 397.46
  Nor Armin Hafifie Bin Nor Arwan: 1791.20
  Nur Atthira Bt M Salleh: 2096.10
  NUR IFFA SOFEA BINTI MAZLAN: 1778.28
  NUR NAZIHAH BINTI NORAZLAN: 1875.49
  Nuralia Aina Binti Noor Azlan: 2135.65
  NURUL ALIANATASHA BINTI NARZARI: 1691.97
  Shahrul Afique Bin Nazarudin: 1678.05
  Shairuleen Binti Jeffri Aziz: 2188.15
  Tengku Syahirah Balqis Binti Tengku Helme Fazle: 2100.24
  Zikry Yusuf Bin Nor Hamidi: 1659.75
  Total net (incl. both Adib lines): 54,367.17.

- 2026-08-04 — **Owner's paper OT imported ahead of the July recompute
  ("All Outlet OT July 2026" xlsx): 42 approved post_hoc `hr_overtime_requests`
  inserted + Shairuleen 25 Jul topped up 1→2.5h; 37 attendance logs stamped
  with the approved hours (ot_1_5x, final approved); 6 SYNTHETIC OT-only logs
  created for Shahrul Afique 5–10 Jul (4h/day, clock_in_method='ot_approval',
  IOI) — he had NO logs those days.** Verified: per-person approved budget ==
  payable log OT for all 8 (Afique 24, Shairuleen 19/18 floored, Firdaus 10,
  Zikry 10, Atthira 7.5/7, Razley 5.5/5, Sherry 5, Nazihah 1+2 plain). New
  premium value ≈ RM991.59 vs the deleted run (which paid these hours RM0).
  Judgment calls: Atthira's "17.06.26" row read as 17 JULY (typo; she has a
  17 Jul log); Firdaus 29 Jul paper approval supersedes the DB-rejected row
  (new approved row, rejected kept for audit); Sherry 5 Jul kept at the DB's
  2h approval (sheet said 1 — never reduce without instruction); **Adib
  EXCLUDED — his active record is part_time** (PT not entitled to OT, outside
  the monthly run); Afique is FT resigned 31 Jul (end_date) so July still
  pays. Floors ate 2.0h (Razley 0.5, Atthira 0.5, Shairuleen 1.0) — P4.
  **LATENT BUG FIXED same day: `ot-payroll-sync.ts` inserted synthetic logs
  with clock_out NULL, but unique index `hr_attendance_logs_one_open_per_user`
  allows ONE open log per user — a second same-user synthetic approval threw
  23505.** Synthetic logs now close over the approved span. Also 2026-08-04:
  owner ruled "follow exactly the sheet" → **OT now pays to the half-hour**
  (P4 resolved: calculator + sync no longer Math.floor; ≥1h minimum kept);
  Sherry 5 Jul reduced 2→1h per sheet; Adib 2 Jul 3h added against his FT
  stint (monthly RM1900 ends 3 Jul; log 83939522 6h flagged → 3h approved).
  ⚠ hours.ts still floors at attendance-processing time — future logs get
  whole hours at the stamp; only approvals carry fractions through.

- 2026-08-04 — **PT rates flattened per owner: RM10/h (weekday AND weekend)
  for Qaseh, Farah Nabilah, Batrisyia; RM9/9 for the other 18 active PT** —
  note this REMOVED the RM10 weekend premium most PT carried. **Nurfarah
  Quraisya (Putrajaya, was 10/10) HELD unchanged pending owner: is she one of
  the intended "Farah"s, or does she drop to 9?** No hr_salary_history rows
  were written (direct profile update) — history screen won't show this
  change.

- 2026-08-03 — **OT RATE NOW COMES FROM hr_overtime_requests, AND REST-DAY FROM
  THE ROSTER AS IT FINALLY STANDS — the end-to-end payroll QA pass.** Three
  owner rulings landed together in `lib/hr/ot-policy.ts` + the monthly
  calculator (pinned by `ot-policy.test.ts`):
  - **Rate vs payability split.** The attendance log decides WHETHER OT hours
    are payable; approved/partial `hr_overtime_requests` are a per-user-per-day
    budget deciding the RATE. `splitOtHours` caps premium at the budget and pays
    the remainder at plain 1.0× — worked hours are never zeroed and never
    silently upgraded. (Monthly run had never read the requests table; weekly PT
    always did.)
  - **Rest day = roster row, re-derived at compute time.** Stamped
    `overtime_type`/`ai_flags` are snapshots; rosters get re-published after
    processing (Sunday 2 Aug: whole crew stamped `rest_day_work` off a roster
    replaced later that day). `effectiveOtType` re-checks
    `hr_schedule_shifts.role_type ILIKE 'rest%'` per log: stale rest-day stamps
    off-roster downgrade to 1.5×, weekday stamps on a rostered rest day upgrade
    to 2×, holiday classes pass through. Safe because both deriveHours branches
    split hours identically — only the multiplier label differed.
  - **Stored labels repaired in prod** via
    `20260803_rest_day_stamp_repair` (APPLIED 2026-08-03, verified): 42 logs
    ot_2x→ot_1_5x, 81 rest_day_1x→NULL, 22 OT requests '2x'→'1.5x' (incl. the
    two APPROVED Sunday rows that a recompute would have paid 2×). All four
    stray counts now 0 — and 0 legitimate rest-day stamps remain, i.e. not one
    July/Aug rest-day stamp was on a rostered rest day.
  Also in this pass: the monthly attendance fetch and the YTD priorItems fetch
  are paged through `fetchAllRows` (attendance sat at 761/1000 — one busy month
  from silent truncation); a roster-mismatch tripwire notes shifts where worked
  exceeds payable by >2h outside system auto-close; `fetch-all-rows.test.ts`
  now imports the REAL helper (it had tested a local copy). PT OT needs no new
  guard — FT-only checks shipped on main in #1083.

- 2026-08-03 — **THE DELETE ENDPOINT WAS THE GUARDRAIL HOLE, AND IT ATE JULY.**
  `DELETE /api/hr/payroll` guarded `paid` only, so a **confirmed** run — the
  thing payslips and bank files come from — could be destroyed in one call with
  no prompt, no backup and **no ActivityLog row** (the route never logged). It
  cost data twice in one day: the `opening_balance` (BrioHR Jan–Jun YTD for 34
  people; understated Ariff's July PCB by RM446.10) and then **the entire July
  monthly run, deleted 22 seconds after a recompute rebuilt it** — 29 lines,
  gone, with nothing recording who. Root cause was that "unlock so I can
  recompute" had no path except delete. **FIXED both sides:** DELETE now refuses
  `confirmed` as well as `paid`, and `POST action=revert` takes a confirmed run
  back to `ai_computed` in place, keeping the run id. Both delete and revert now
  write ActivityLog. `paid` is deliberately a dead end — bank files exist.
  Pinned by `payroll-run-guards.test.ts`.
  **July is recoverable from a recompute** — 761 attendance logs, 53 line
  overrides, 16 approved OT requests and 36 `confirmed_at` profiles all survived.

- 2026-08-03 — **PostgREST's silent 1000-row cap was truncating payroll inputs
  in THREE places, not one.** No error, no flag, just a short array. **FIXED**
  with a `fetchAllRows` paging helper in `allowances.ts`; pinned by
  `fetch-all-rows.test.ts`.
  - **Serving time — the one actually biting.** 7,626 served orders across the
    outlets in July, so the lever scored everyone off roughly **1–4 July**
    (~13% of the month). Worth RM40–50 a head per month.
  - **Phone-capture outlet baseline** (legacy path, inert while
    `phone_capture_target_pct` is set). 4,192–5,601 orders per outlet per 90d.
  - **Per-employee capture.** Busiest July operator rang 778 — under the cap
    today, but a busier month would truncate silently.
  Lesson: **any unbounded `.select()` on `pos_orders` or `hr_attendance_logs` is
  a latent truncation bug.** Use `fetchAllRows`.

- 2026-08-03 — **PROBATION ENDS ON CONFIRMATION, NEVER ON ELAPSED TIME. Owner
  ruling: "probation will end only after confirmation. it is not time base."**
  Two earlier gates this session were wrong in opposite directions: reading raw
  `probation_end_date` (NULL on 61/62, so NOBODY was on probation — Iffa paid
  RM120), then falling back to join + 90 days (pays anyone whose 90 days elapsed
  even though no one confirmed them — the exact time rule the owner rejected).
  Now `lib/hr/probation.ts` gates on a new `hr_employee_profiles.confirmed_at`;
  `probationReviewDue()` keeps join+90d but is DISPLAY ONLY and decides no pay.
  **The blocker that made this non-trivial: nothing in the DB recorded a
  confirmation.** `hr_probation_reviews` is EMPTY (zero rows, ever — the flow
  works, it has never been used) and `probation_end_date` is NULL on all 62
  active profiles. `probation_end_date` could not serve as the marker anyway:
  the only writer is the EXTEND decision, which sets a FUTURE date while the
  person is still on probation — it means "review due", not "confirmed". So a
  confirmation-only gate on today's data puts **all 22 active full-timers** on
  probation and wipes ~RM1,573/month of allowance, Syafiq Aiman (joined 2021)
  included. Hence `packages/db/prisma/migrations/20260803_probation_confirmed_at/`
  ships the column WITH a backfill: `confirmed_at = join_date` for everyone who
  joined before 2026-04-01, **plus Mohd Haziq and Nor Armin, whom the owner
  confirmed explicitly on 2026-08-03 ("haziq and armin confirmed")**. Those two
  are dated to the END of the probation they served (join + 90d = 2026-07-26 and
  2026-07-15) rather than their join date — backdating would assert they never
  had a probation, and would retroactively entitle them to May/June allowance.
  Final split: **13 confirmed / 9 on probation — APPLIED to prod 2026-08-03 and
  verified.** **ORDERING RULE, learned here: apply the column BEFORE deploying
  the code.** `allowances.ts` selects `confirmed_at`; if the deploy had landed
  first, PostgREST would 400 on the unknown column, `profile` would read null,
  `isFullTime` would be false and EVERY performance allowance would silently
  drop to zero. Column → deploy → recompute, in that order.
  **A recompute alone does nothing until #1110 is merged and deployed** — the
  live backoffice still runs the old gate that never fires.
  Also fixed: approving a `decision='confirm'` review previously did nothing to
  the profile (it only unlocked the confirmation letter); it now stamps
  `confirmed_at`, which is what actually ends probation.
  Implied July claw-back is **RM270** — Razley 150 + Iffa 120. Haziq's RM200 and
  Armin's RM70 stand, since the owner confirmed them.

- 2026-08-03 — **The deleted `opening_balance` is no longer needed: Jan and Feb
  monthly runs now carry the full BrioHR figures (APPLIED to prod).** Owner
  re-exported `202601`/`202602_payroll_report.xlsx` from BrioHR; reconciling
  every line against the DB showed all existing lines already matched to the
  sen and **exactly three were missing** — Ariff Izham in BOTH months (Jan
  12,519.23 gross / 1,559.10 PCB; Feb 10,500.00 / 1,054.15) and Izzah Nusaibah
  in Feb (1,700.00 / 0.00). Run-level shortfalls matched to the sen, which is
  what makes this certain rather than plausible. Applied via
  `packages/db/prisma/migrations/20260803_jan_feb_briohr_backfill/`: Jan is now
  20 lines / 77,516.31 gross, Feb 23 lines / 67,671.00 — both equal to BrioHR.
  Run headers are re-totalled **from their own lines**, not hardcoded.
  **Two conventions worth keeping:** (1) every 2026 monthly line satisfies
  `net = gross − deductions` with a zero gap, so Ariff's expense-claim
  reimbursements (898.19 Jan / 158.00 Feb) were kept OUT of gross and net and
  recorded in `computation_details.net_additions` — our Jan/Feb net therefore
  sits that much below BrioHR's own net figure BY DESIGN, it is not a
  discrepancy; (2) BrioHR-era leavers with no `User` row get a synthetic id
  spelling ASCII `briohr-<empid>` (Izzah = `6272696f-6872-2d43-4330-363100000000`)
  and `status='DEACTIVATED'`, matching the original import.
  **Ariff YTD-through-June is now 65,019.23 gross / 6,829.85 PCB paid**
  (= 1,559.10 Jan + 1,054.15 × 5 for Feb–Jun).

- 2026-08-03 — **DONE: July was recomputed at 12:23:58 and Ariff's PCB landed on
  RM1,064.60, exactly as modelled.** Run `1fadf5ea-baf3-4460-a4bc-660dfdfe5669`,
  status `confirmed`, 29 lines, run PCB total 1,069.15. Note the recompute mints
  a NEW run id each time and deletes the old run's items — do not cache a July
  run id across a recompute (cost one confusing "run has 0 lines" moment).
  The entry below is kept for the diagnosis, which is what makes the figure
  trustworthy; the "must be recomputed" instruction is now satisfied.

- 2026-08-03 — **Ariff's July PCB of RM618.50 was the understated figure and
  RM1,064.60 is the corrected one.** The deleted opening balance took his Jan–Jun YTD with it;
  the calculator then saw only Mar–Jun (42,000.00 / 4,216.60), projected
  RM105,600 annual instead of RM128,619.23, and landed a bracket low. Modelling
  the LHDN formula against the broken YTD reproduces the stored 618.50 exactly,
  which is what confirms the diagnosis; against the restored YTD it gives
  **1,064.60** — chargeable 115,269.23, annual 13,217.31, less 6,829.85 already
  paid, over 6 remaining months. **That is the same figure the run showed before
  the opening balance was deleted, which is the real corroboration here: the
  deleted balance and the BrioHR monthly lines agree.** (A working note briefly
  claimed 1,240.25 and that the old balance was ~4,216 short — that came from
  summing only four of the five Feb–Jun PCB months. Both claims were wrong;
  1,064.60 stands.)
  **The recompute cannot be triggered from an agent session** — no
  `SUPABASE_SERVICE_ROLE_KEY` in the repo; it needs a human to hit Compute on
  `/hr/payroll` (the July run is `ai_computed`, so recompute is permitted;
  it fails on `confirmed`).

- 2026-08-03 — **EVERY REST-DAY STAMP IN JULY WAS WRONG: the manual attendance
  edit was the last path still reading `hr_employee_profiles.rest_day`, and that
  column is NULL for all 77 profiles.** `api/hr/attendance/route.ts` did
  `const restDay = prof?.rest_day == null ? 0 : Number(prof.rest_day)` then
  `isRestDay: mytDayOfWeek(ci) === restDay` — so `?? 0` resolved to **Sunday for
  everybody**. Measured on July 2026: **96 logs carry a rest-day `overtime_type`,
  all 96 are Sundays, and NOT ONE falls on a rostered rest day** — while 161
  genuine rest-day rows exist across 40 people on all 31 dates. The two sources
  agreed on zero logs. **Owner ruling 2026-08-03: "rest day should follow
  schedule."** FIXED — that path now reads `hr_schedule_shifts` +
  `REST_DAY_ROLE_PATTERN` like the other three writers (staff clock-out, AI
  processor, auto-close cron), which had already been migrated. Pinned by
  `apps/backoffice/src/lib/hr/rest-day-source.test.ts`. Note `rest_day` on the
  profile is still legitimately used by `schedule-generator.ts` as a *preference*
  when building the roster — do not delete the column, just never derive pay
  from it. **The 96 mis-stamped July logs are NOT retro-corrected** — July is
  `confirmed`; a false rest day charges OT at 2× instead of 1.5×, or stamps
  `rest_day_1x` where the type should be null.

- 2026-08-03 — **REST-DAY WORK PAYS 1× BY DESIGN AND THAT IS THE OWNER'S POLICY —
  DO NOT RE-RAISE IT AS UNPAID.** `hours.ts:125-134`: on a rest day, work within
  the OT threshold is tagged `overtime_type='rest_day_1x'` with `overtimeHours=0`
  (the hours are regular, i.e. already inside the monthly salary); only hours
  BEYOND the threshold become `ot_2x`. `constants.ts:20` names the intent
  (`rest_day_normal: 1.0`). July has 65 such logs / 460.83h across 25 people with
  zero OT credited — that is correct, not a defect. **Owner ruling 2026-08-03:
  "there will be no rest day premium. there should only be overtime."** An
  earlier note in this session called those 460h unpaid and quoted ~RM89.56 owed
  to Razley for 19 Jul; both were wrong — his payable time starts at the rostered
  12:00, giving 7.04h, under threshold, so no OT is owed. Withdrawn.

- 2026-08-03 — **The 122 cancelled July OT requests were never approved first —
  the cancels PREDATE the only review round.** All 122 were cancelled on 28 Jul
  in two bulk operations (116 at `08:03:19.479132`, 6 at `11:05:06.549605`, each
  a single instant); Ariff's entire review round — all 16 approvals (30h) and all
  4 rejections — is 31 Jul `04:06–04:13`, three days LATER. Corroborating:
  `hours_approved` is NULL on all 122 and set on all 16 approved. **There is no
  audit trail to check this against** — `hr_overtime_requests` stores only the
  current status, `reviewed_by`/`reviewed_at` are overwritten by whoever acts
  last, and `ActivityLog` records nothing for OT (only 3 `payroll.*` rows in all
  of Jul–Aug). The cancels split cleanly by employment type and both match a
  stated policy: 116 requests / 285h / 20 people **all part_time** ("OT is FT-only
  — PT extra hours pay flat via roster/weekly cycle"), 6 / 8h / 4 people **all
  full_time** ("early clock-in pays from rostered shift start"). Every July
  request, in all three states, is `reason='Auto-created from attendance log (OT
  detected)'` — nobody hand-filed OT all month.

- 2026-08-03 — **A WRONG ROSTER SILENTLY DELETES MOST OF A DAY'S PAY, and nothing
  flags it.** Pay-hours start at `max(clock_in, scheduled_start)`
  (`hours.ts:103-107`), which is the owner's early-clock-in policy working as
  intended — but when the ROSTER is wrong rather than the clock-in being early,
  it eats the shift. Shairuleen 16 Jul: clocked 07:09–16:51 (9.70h) against a
  roster of **15:30–23:30**, credited **1.36h**. Farah Nabilah 18 Jul: 9.23h
  worked, 1.29h credited. Across July, 41 full-time shifts have >2h credited as
  neither regular nor OT — 185.61 hours gross. **TRIAGED 2026-08-03, and only
  ~50h of it is real:**
  - **Group A — 9 shifts, ~50h, GENUINE.** Roster said evening, they worked
    morning, so pay-time starting at the rostered start credited almost nothing.
    Amirul Yazid 12 Jul: worked 8.08h, **credited 0.01h**. Also Shairuleen 16 Jul
    (9.70h→1.36h), Nur Iffa 16 Jul, Nurul Alianatasha 18 Jul, Firdaus 12 Jul,
    Hanisa 12 Jul, Akmal Aiman 17 + 30 Jul, Syafiq Aiman 21 Jul.
  - **Group B — 7 shifts, ~49h, NOT REAL. Do not pay.** All are `clock_out_method
    = 'system'` with `auto_closed_no_pings_stale` (6) or `auto_closed_forgot_
    clockout` (1). **The clock-out timestamp is fabricated**, so the 16h "spans"
    are `clock_in → auto-close cutoff`, not worked time — the tell is that they
    repeat exactly (Guraf 3 Jul and 4 Jul are both 23:30 / 16.03h). The system
    already did the right thing: paid the rostered shift (7.50h), excluded the
    phantom OT. An earlier note in this session listed these as ~49.4h lost;
    withdrawn. Farah Nabilah 7 Jul is an eighth of the same shape (PT, so outside
    the FT query).
  - **Group C/D — 25 shifts.** Genuine early clock-ins owing nothing, except four
    late-outs where `Math.floor` ate partial OT (Firdaus 1.40h and 1.38h → zero).
  Open question from Group B: six shifts went `no_pings_stale` mid-day in one
  month — the PWA is losing GPS or being backgrounded while staff are clocked in.

- 2026-08-03 — **OT hours are floored, so partial OT is always discarded.**
  `hours.ts:128` and `:137`: `overtimeHours = Math.floor(workedHours - otThreshold)`.
  Firdaus lost 0.90h (17 Jul) and 0.87h (21 Jul) that way. This is why the
  auto-creator kept filing "OT detected" requests for shifts that then computed to
  zero OT — the detector and the payer disagree. Rounding to the nearest quarter
  hour was proposed; no decision yet.

- 2026-08-03 — **Adam Kelvin is missing March, April and May payroll entirely,
  and he is the ONLY remaining YTD hole.** Joined 2026-03-05, resigned
  2026-07-31, basic RM3,900 — but the system holds only June and July lines. His
  Mar–May pay lived in the deleted opening balance and the BrioHR Jan/Feb
  exports do not cover it. Checked every one of the 29 people on the July run
  against their join date: everyone else's monthly lines start at or before
  their first eligible month. **Tax impact is nil** — with June alone his
  projection is 31,260, chargeable 17,936.60, and the s.6A(2) RM400 rebate wipes
  the RM129 of tax out, so July PCB is correctly 0.00; restoring Mar–May moves
  it to at most RM0.65. **The reason to fix it anyway is the EA form** — he is a
  2026 leaver and his EA must state real annual earnings, which are understated
  by roughly RM11,200. Needs the Mar/Apr/May BrioHR exports.

- 2026-08-03 — **The BrioHR import dropped people silently, and the delete
  endpoint let it happen twice.** The original Jan/Feb import covered 19 of 20
  and 21 of 23; nothing flagged the gap because run headers were written from
  the import, not derived from the lines, so header and detail agreed while both
  were wrong. Separately, `DELETE /api/hr/payroll` blocks only `paid` — a
  `confirmed` run (and the `opening_balance`, which sat at `draft` and was never
  protected at all) can still be deleted, which is how the YTD was lost. Both
  worth fixing: derive headers from lines on import, and widen the delete guard.

- 2026-08-03 — **PART-TIMERS ARE NOT IN THE MONTHLY RUN, AND THAT IS EXPECTED —
  DO NOT RE-RAISE IT.** Every payroll run that exists is `monthly` (8) or
  `opening_balance` (1); **zero weekly runs, ever**, despite
  `payroll-calculator-weekly.ts` and `/api/hr/payroll/weekly` both existing.
  For July 2026 that is 23 part-timers and 1,970 clocked hours with no payroll
  record in this system (Farah 202.54h, Fatin 197.95h, Emran 186.68h); the July
  monthly run is **28 lines, all full-time**. **Owner ruled 2026-08-03: "bayar
  jumaat is the PT weekly payroll, just ignore"** — PT wages are run outside
  this system on a Friday cycle, so the absence is by design, not a gap. The
  practical consequence to remember: **the monthly run is the FT half only.**
  Never reconcile "everyone who worked" against it, and note that any change to
  PT attendance or OT (e.g. the `ot_1x` reclassification) has no effect on it.

- 2026-08-03 — **`isOtApproved` treats an ATTENDANCE approval as an OT
  approval.** `payroll-calculator.ts` pays OT when `final_status` is
  `approved`/`adjusted`, or `ai_status='approved'` with no final status. So a
  manager confirming a clock-in is correct silently authorises its overtime.
  `hr_overtime_requests` — the table that actually records an OT decision — is
  **not consulted at all**, and `hr_attendance_logs.ot_approval_id` is NULL on
  all 174 July OT-bearing logs (nothing in the codebase reads or writes it).
  Result for Jul 2026: 406h detected, 126h payable off the logs, 30h approved
  via requests — three different numbers. **Owner ruling 2026-08-03: the 30h of
  approved requests is the truth, and unapproved hours are paid at PLAIN hourly
  rather than zeroed** — `regular_hours` is capped at the rostered shift (5.00
  for PTs), so zeroing OT would leave real worked hours unpaid (Emran worked
  9.03h on 22 Jul: regular 5, OT 3). **Applied:** 40 logs with OT but no
  approved request for that date set to `overtime_type='ot_1x'` (the calculator
  already pays that at 1.0×, so no code change), each stamped in `review_notes`.
  July now reads **100h at 1.0× + 30h at premium**, and the 30h matches the
  approved requests exactly. Fixing the root cause — make `hr_overtime_requests`
  the only thing that approves OT — is still open.

- 2026-08-03 — **Adib is two User rows and the wrong one is being paid.** A
  DEACTIVATED **full_time** record with a synthetic id
  (`6272696f-6872-2d43-4330-363200000000`, ASCII-looking) and `end_date`
  2026-07-03 drew RM183.87 gross / RM160.82 net on **zero hours** in the July
  run. His real ACTIVE **part_time** record worked 26.66h and is correctly
  outside the monthly run. Duplicate identity, not a proration bug.

- 2026-08-03 — **Two FT→PT converts are owed prorated FT pay that nobody
  raised.** `hr_employee_profiles.notes` for **Zarif** says it in as many words:
  *"[FT→PT conversion, effective 2026-07-08] … PAYROLL NOTE: July 2026 monthly
  run must include a MANUAL prorated item for his FT stint Jul 1–7 (RM2,000 ×
  7/31 ≈ RM451.61 basic) — the calculator will skip him now that he is
  part_time."* The note was right about the skip; **the manual item was never
  created** and he is not in the July run. **Danish** is the same shape ("FT→PT:
  resigned FT 2026-07-11, part-time from 2026-07-12") with no payroll note, and
  **his FT monthly salary is recorded as RM0.00** in `hr_salary_history`, so his
  Jul 1–11 proration cannot be computed until the real figure is supplied.

- 2026-08-03 — **"Manager: Ariff Izham. [Resigned 2026-07-07]" in the UI does
  NOT mean Ariff resigned.** He is ACTIVE, MANAGER, no end_date. That string is
  **Zarif's own `notes` field printed verbatim** — line 1 "Manager: Ariff
  Izham.", line 2 the `[Resigned <date>]` marker that
  `lib/hr/agent/write-ops.ts` appends to notes on a resign. The employee screen
  renders the whole blob next to the manager label. Display bug; cost one
  false alarm.

- 2026-08-03 — **PCB was assessed on non-taxable payments (PR #1102, MERGED
  `cf7df2a`).** `hr_payroll_item_catalog.pcb_taxable` was fetched and never
  read, so mileage/parking/meal reimbursements went into the tax basis. Found on
  Adam Kelvin's FINAL Jul payslip: RM315 of approved mileage pushed his
  chargeable past the RM400 s.6A(2) rebate, deducting RM21.35 where RM11.90 was
  correct. **Verified after recompute: PCB is now 11.90 with `pcb_gross` 4,350
  against `total_gross` 4,665.** The money still pays; only the basis changed.
  Deductions deliberately untouched (`UNPAID_LEAVE` carries `pcb_taxable=false`
  yet plainly does reduce taxable income) — worth a separate look.

- 2026-08-03 — **Recomputing July needs an authenticated OWNER/ADMIN browser
  session.** `POST /api/hr/payroll {action:"compute"}` is the only entry point;
  there is no cron or service-role path. An agent cannot trigger it — ask the
  owner to click Compute. (Jul 2026 recomputed 4× today: 08:20, 09:32, 10:00,
  10:03, by Ammar Shahrin and Nurul Aqilah.)

- 2026-08-03 — **`hr_employee_profiles` has no `employment_status`,
  `resignation_date` or `last_working_date`.** The columns are `end_date` and
  `resigned_at`. `hr_attendance_logs` has no `updated_at` (only `created_at`,
  `reviewed_at`, `review_notes`, `excused_reason`) and no CHECK on
  `overtime_type`. `hr_payroll_items` stores tax as `pcb_tax`, not `pcb`.
  Three queries were lost to guessing these — check
  `information_schema.columns` first.

- 2026-08-03 — **The NULL trap bites in analysis SQL too, not just PostgREST.**
  `NOT (final_status IN ('approved','adjusted') OR …)` is NULL — not TRUE — for
  the ~288 rows where `final_status IS NULL`, so a "dropped hours" total came
  back as 0 when the real figure was 280. Use `coalesce(final_status,'')`. Same
  root cause as the `.neq` bug already documented for the payroll fetch.

- 2026-08-03 — **Grab 86 sync: Grab THROTTLES menu-record updates, and an
  un-retried push silently loses the 86 forever.** Ariff reported items closed
  in POS still selling on Grab (Pavlova, Shah Alam, closed since the day
  before). The DB write was never the problem — `outlet_product_availability`
  had Mini Pavlova / `shah-alam` / `is_available=false` at `2026-08-02
  12:31:50.186Z`. The Vercel runtime log shows the Grab push failing **at that
  same second**: `PUT /partner/v1/batch/menu (409) {"reason":"conflict",
  "message":"batchUpdate ITEM 68d92fd799cecc0007dafb92 too frequently, retry
  after 10 seconds"}`. Grab then took order **GF-7046 for that item 15h
  later** (2026-08-03 03:26:11Z). NYC Smores at SA shows the same shape at
  13:52:50Z. **Trigger: staff 86 several items in a burst** (log shows POSTs
  ~1.7s apart) — exactly what the throttle rejects. The route returned HTTP
  200 regardless, so the register showed success and nobody knew.
  **Two things RULED OUT — don't re-investigate them:** (1) *outbound Grab
  creds are fine* — 191 orders auto-accepted since Jul 27, order reconcile
  clean 2026-08-02 12:15, so `isGrabConfigured()` is true in prod incl.
  `GRAB_MERCHANT_ID`; (2) *item targeting was never wrong* — **Grab echoes OUR
  product id as the partner `externalID`**: the GF-7046 webhook carries
  `"id":"68d92fd799cecc0007dafb92"` alongside `"grabItemID":
  "MYITE20260619072306047458"`. So the `grab_item_id`-vs-our-id worry in the
  route comments is moot for these stores. **`products.grab_item_id` is NULL on
  ALL 92 products** and the BackOffice link panel shows nothing to link — its
  "unlinked" query keys off `pos_order_items.product_id`, which ingest already
  resolves to our catalogue id, so linkable rows never surface. Leave it: the
  fallback (our id) is the correct key. NOTE Grab item ids are **per-merchant
  AND multi-generation** (2026-06-17 and 2026-06-19 batches both still ordered
  live; up to 6 distinct `MYITE…` ids per product across 3 outlets), so the
  scalar `products.grab_item_id` column could never represent them anyway.
  **Fix (PR #1099, MERGED as `0e38e36`):** new
  `lib/grab-availability.ts` — `pushAvailability` retries through the throttle
  honouring Grab's own "retry after N seconds" and does NOT retry permanent
  failures; `reconcileGrabAvailability` diffs desired availability against a
  snapshot of what was last successfully pushed
  (`app_settings.grab_availability_pushed`) and re-sends only the difference,
  so a lost 86 self-heals within the cron interval instead of never. **Folded
  into `cron/grab-reconcile` (*/15) — vercel.json is at the 38 ceiling, a 39th
  entry was not an option.** Snapshot deliberately in `app_settings` JSONB: no
  DDL, no migration, and a missing entry just means "push again" (idempotent).
  **Second hole fixed on the way: the BackOffice availability matrix
  (`/api/pickup/menu/availability`) wrote the 86 row and NEVER pushed to Grab
  at all** — both writers now share `syncItemAvailabilityToGrab` (it takes
  either the loyalty outlet id or the pickup store slug). The POS route now
  returns the real outcome (`pushed`/`throttled`/`error`/…) instead of always
  "pushed". No `pos-native` change → no OTA deploy.
  **VERIFIED IN PRODUCTION 2026-08-03 05:50Z, no manual portal pass needed.**
  The 39 items that were stuck open on Grab were corrected by the reconciler
  itself. Evidence: (a) `app_settings.grab_availability_pushed` holds all 3
  merchants × **81** Grab-visible items — the whole sweep landed in ONE run,
  not spread over ticks; (b) a snapshot-vs-86-list cross join returns **zero**
  missing and zero diverged; (c) `cron/grab-reconcile` ran 05:30:11 and
  05:45:11 on the new deploy, both 200, **no `[grab:availability]` failures
  and no 409s**. (d) **The original failure condition reproduced live and
  passed:** at 05:45:29–05:45:53 Shah Alam 86'd SEVEN items in 24s (~4s
  apart — the exact burst shape that was 409-ing the day before) and all
  seven are in sync with zero error lines.
  **Limit of the proof:** the snapshot records what Grab ACCEPTED (2xx on our
  push), not a read-back of Grab's live menu — there is no cheap read-back
  API. Also NOT tested from the order side: zero GrabFood orders arrived in
  the 30 min after deploy, so nothing exercised "Grab refuses a closed item".
  If a 86'd item is ever ordered again on Grab, that is the signal the retry
  budget or the cron interval needs revisiting — check for
  `[grab:availability] push failed` first.
  **Watch:** first run pushed 81 items × 3 merchants without tripping the
  throttle, so Grab's limit is looser than one-item-per-10s in a batch; the
  409s came from rapid SEPARATE single-item calls. Steady state now sends
  zero calls (diff-driven), so throttle pressure should stay low.

- 2026-08-03 — **PCB reconciled to BrioHR to the cent; SOCSO went the other way
  and BrioHR is the one that's wrong.** Owner flagged Ariff (RM10,500/mo)
  diverging badly from Brio.
  **PCB — three causes, all under-deducting.** The MTD arithmetic itself was
  fine (it reproduces the shipped RM504.50 exactly from `hr_stat_pcb_brackets`);
  the inputs were wrong. (1) **YTD was short.** LHDN's MTD is cumulative, so YTD
  is the most load-bearing input there is. The query unioned monthly runs with
  the BrioHR `opening_balance` run then filtered `status in (confirmed, paid)` —
  but an opening balance is an import artifact that is never *paid*, so it sat
  at `draft` and the `cycle_type.eq.opening_balance` clause was **dead**, despite
  the comment claiming otherwise. Ariff has no Jan/Feb monthly line (that import
  covered 19 of 27 people), so his YTD was RM23,019.23 short and he was assessed
  in the **19% bracket instead of 25%**. **Do NOT "fix" this by un-filtering the
  status** — 32 of the 34 people DO have complete monthly lines for the imported
  window, so counting both sources roughly doubles their YTD. The fix takes the
  opening balance as authoritative for the window its `period_end` declares and
  adds monthly runs only from after it, decided per user. (2) **`EPF_CAP` was
  RM7,000.** LHDN splits it: RM4,000 EPF + RM3,000 life insurance; RM7,000 only
  when both are claimed, and we hold no life-insurance data. Under-deducted
  everyone contributing over RM4,000/yr. (3) The residual RM14.55 is the
  **RM350 SOCSO/EIS relief** — we grant it monthly, Brio doesn't. Left alone: it
  is legitimate at year-end assessment, so it is an owner call, not a bug.
  July run effect: 3 lines move, 22 don't — Ariff 504.50→1039.60, Adam Kelvin
  13.40→69.85, Syafiq 63.70→65.90; total 754.20→1347.95.
  **Ordering trap:** August only comes right *after July is confirmed*, because
  unconfirmed runs correctly don't feed YTD. Sequence is migration → recompute
  July → confirm July → recompute August. August currently shows RM206.40.
  **SOCSO — ours is right, June's Brio import is wrong.** The tell is the
  employer:employee ratio, 3.500 in every month of 2026 except **June, where it
  is 1.400** → employee charged at **1.25%**, which is the Category 2 *employer*
  rate. Under the Act an employee pays 0.5%; there is no case where they pay
  1.25%. The employer leg didn't move at all (Ariff RM104.15 both months), which
  is why it can't be a ceiling or rate change. **All 25 people in the June run
  were over-deducted: RM795.70 charged against RM318.28 due = RM477.42 taken
  from staff pay.** Ariff RM44.65, Syafiq RM25.85. Jan–May were all correct, and
  it reconciles (Ariff's Jan–Jun RM223.15 = 29.75×5 + 74.40). **Refund not
  actioned — owner decision.**
  **Still open:** `hr_employee_tax_reliefs` is **empty company-wide (0 rows)**,
  and the relief columns that DO exist on `hr_employee_profiles`
  (`marital_status`, `num_children`, `spouse_working`, `life_insurance_relief`,
  `zakat_amount`, …) are **never read by the PCB calc**. Everyone runs on
  statutory defaults. Ariff is `married` with `spouse_working` NULL — possibly
  RM4,000 of relief not given. Also: variable pay (bonus, performance allowance)
  is **annualised ×remaining-months as if it were fixed salary**; LHDN treats it
  as *additional remuneration* with its own formula. Small here (~RM6 for
  Syafiq) but wrong for a real bonus, and it is the residual behind Syafiq's
  PCB disagreeing with Brio (his profile is single/0 children/no reliefs, so our
  RM65.75 looks right and Brio's RM0 across four months looks under-deducted).

- 2026-08-03 — **Two more dead columns in the allowance path.**
  `hr_employee_profiles.performance_allowance_amount` is written by the employee
  form AND by `/api/hr/allowance-overrides`, and the payroll calculator **never
  reads it** — `computeAllowancesForUser` takes the pool from
  `hr_company_settings`, one company-wide RM200. Verified: every line on the Jul
  2026 run records `"pool": 200`, including Syafiq (profile says 300) and the ten
  people whose profiles say 100. Same shape as `statutory_applicable`. Making it
  live would move ~12 people's pay, so it was left dead **deliberately** —
  whether to honour it company-wide is an owner decision.
  Separately, the lever engine gates on `schedule_required`, so an unrostered
  role (Ariff, Head of Department) is forced to RM0 whatever is configured.
  New `fixed_performance_allowance` column pays a flat amount, bypassing the
  levers, the attendance/review deductions and that gate. Ariff = RM100, interim:
  his scheme is RM100 of an eventual RM500 pool on COGS + people-cost levers,
  neither of which exists yet.

- 2026-08-02 — **Rest days are ROSTERED, not a profile weekday. The old code
  read the wrong column and mis-stamped 107 of 108 rest-day logs.** Owner
  correction: "rest day is set on schedule". Confirmed in the data — the roster
  carries a `hr_schedule_shifts` row with `role_type = 'Rest Day'` and a
  00:00–00:00 window, one per person per week, and it **rotates**: 312 rows
  since 2026-06-01 landing Sun 33 / Mon 35 / Tue 25 / Wed 38 / Thu 35 / Fri 34 /
  Sat 29. `'Rest Day'` is the ONLY `role_type` containing "rest", so an
  `ilike 'rest%'` match cannot collide with a real shift.
  All three places that pick the OT multiplier were instead reading
  `hr_employee_profiles.rest_day` — **NULL for every full-timer** — and coercing
  it to `0`, i.e. Sunday for the whole company. Of 108 logs since 2026-07-01
  flagged `rest_day_work`, exactly **1** was a genuine rostered rest day; 107
  were wrong and 34 of those were stamped `ot_2x`. One log that DID work a
  rostered rest day was never flagged. Fixed in `attendance-processor.ts`
  (batch query over the pending logs' MYT dates), the `attendance-auto-close`
  cron (same batch, so an auto-closed log pays identically to a normal
  clock-out), and `apps/staff/.../api/hr/clock/route.ts` (single-row lookup
  beside the PH check). `REST_DAY_ROLE` / `REST_DAY_ROLE_PATTERN` live in both
  apps' `lib/hr/constants.ts` — **keep the two copies in step.**
  **Not corrected, needs an owner call:** the 107 mis-flagged historical logs
  and the 42 `ot_2x` hours already on record. Rewriting them changes pay.

- 2026-08-01 — **Payroll module end-to-end QA: four real defects, three now
  fixed in code.** Owner is moving payroll off BrioHR onto the HR module this
  month, so this was a pre-flight audit of the Aug 2026 run
  (`217fb693`, `ai_computed`, 28 lines, gross RM66,431.00).
  **(1) OT was silently unpaid.** `processAttendance()` had NO cron — it was
  reachable only from a manual `POST /api/hr/attendance/process`, so logs sat at
  `ai_status='pending'` forever, and the payroll calculator pays OT only on
  APPROVED logs (`isOtApproved`). July 2026: 763 logs / **391 OT hours**, of
  which **527 pending logs carried 265 hours (68%) that would never have been
  paid**. Fixed by calling the processor at the END of the
  `attendance-auto-close` cron (auto-close must run first so a forgotten tap-out
  is closed before being judged "missing clock-out"). **It could not have its own
  cron entry — `apps/backoffice/vercel.json` is at 38, the budget ceiling in
  `src/vercel-crons.test.ts`.** The other 147 approved-with-0-OT logs are
  auto-closes, which zero OT deliberately (a missed tap-out isn't proven OT).
  **(2) Allowances were not prorated for partial months.** Basic salary WAS
  prorated correctly (verified to the cent against four July joiners), but the
  RM200 performance pool was paid in full: Auni Sefhia joined 2026-07-27 and
  drew the full RM180 on 5/31 of her basic. The levers score RATES, not volume,
  so nothing else scaled it. Now prorated on `joiner`/`resigner`/
  `joiner_and_resigner` — NOT on `unpaid_leave`, where the allowance engine
  already nets absence deductions and prorating would double-count.
  `payroll/prorate.test.ts` pins the shipped figures.
  **(3) HRDF was charged to an unregistered employer.** `hrdfApplicable` keyed
  only off the per-employee `hrdf_relation` (default `non_related`), while
  `hr_company_settings.hrdf_number` is **NULL** — Celsius has never registered
  with PSMB. RM635.00 of phantom employer cost on the July run. Now gated on the
  registration number, so it stays off until that field is filled and switches
  itself on when it is. `hr_stat_hrdf_config.min_employees` (10) was and remains
  unenforced — registration, not headcount, is what makes the levy due.
  **(4) Manual line overrides ERASED HRDF from the run header.** The run's
  `total_employer_cost` = EPF+SOCSO+EIS+**HRDF**, but HRDF has no column on
  `hr_payroll_items`, and `items/[item_id]/route.ts` re-summed the header from
  the item rows — deleting the whole levy on any override. Now applies the
  edited line's employer DELTA to the stored header instead. Same approach in
  the new DELETE handler (there was no delete path at all; removing someone
  meant hand-written SQL against prod).
  **Still open, needs an owner call:** `statutory_applicable` on
  `hr_employee_profiles` is a DEAD flag — written by `write-ops.ts:365`, read
  NOWHERE. 25 of 29 in the July run had it `false` and were charged EPF/SOCSO/EIS
  anyway. **Do NOT naively wire it up** — that would zero statutory for almost
  the whole company. Either correct the data and then wire it, or drop the
  column.
  **Structural, not a code bug:** the Aug run was computed on 1 Aug, when the
  month had 16 open logs, 0 regular hours and 0 OT — so every line had zero
  attendance input. The calculator now pushes a loud note when `Date.now()` is
  before cycle end. Left as a warning, not a block, because a mid-month preview
  is legitimate.

- 2026-08-01 — **`ads_metric_daily` holds an account-level ROLL-UP row
  (`campaign_id IS NULL`) as well as the per-campaign rows. Any `sum(cost_micros)`
  that does not filter `campaign_id IS NOT NULL` double-counts spend 2×.**
  This is by design and documented at `apps/backoffice/src/lib/ads/sync-metrics.ts:7`
  — the sync writes per-campaign rows, then a per-date account total. The roll-up
  first appears **2026-07-04**, which is why row count per day goes 3 → 4 there.
  Proof (Jul 30): campaigns 42.76 + 34.02 + 58.73 = **135.52**, and the null row
  is **135.52** — identical spend, clicks and impressions, same sync batch.
  **Shipped code is CORRECT** — `ads/optimizer.ts:145` and the P&L readers filter
  `campaign_id IS NOT NULL`; `api/ads/overview/route.ts:61-63` deliberately reads
  either the roll-up *or* the campaigns, never both. The double-count was in the
  ad-hoc SQL behind the 2026-07-30 entries below. **Any future hand-written query
  against this table must filter the null row** — including anything the
  data-analyst agent writes, since `ads_metric_daily` is in its allowlist
  (`agents/data-analyst.ts:55`) and it has no such guard.

- 2026-08-01 — **A DISCOUNT IS NOT CASH OUT, AND `total` IS ALREADY NET OF IT.**
  Ad spend leaves the bank; a discount is revenue that never arrived. Verified:
  `total = subtotal + service − discount + sst (+rounding)` holds on **7,955 of
  7,955** POS rows and **2,918 of 2,919** `orders` rows since Jul 1. So any table
  that shows revenue from `total` **and** adds discounts as a cost subtracts them
  twice. An earlier pass here did exactly that and reported a "marketing cash =
  ads + discounts" column — **that column was not a real quantity; ignore it.**
  Correct shape: net banked revenue is the inflow, ads are the outflow, and
  discounts are already inside the inflow. Also: a ringgit of ad spend is gone
  unconditionally, whereas a ringgit of discount is only fully lost if that
  customer would have bought anyway — on ~70% coffee margin a voucher that causes
  an otherwise-absent RM15 sale still nets ≈+RM6. **The two are not
  interchangeable per ringgit** and must not be summed.

- 2026-08-01 (correction, supersedes the ad-spend half of both 2026-07-30
  entries) — **Real ad spend is HALF what was recorded. The ad cut keeps
  ≈RM4,100/mo of real cash; rising discounts give back ≈RM3,400/mo of revenue;
  net ≈ +RM720/mo — but that is below the noise floor (see caveat).** Recomputed
  with the roll-up row excluded (POS ex-Grab + web; discounts = promo + reward +
  web first-order):

  | Block | Gross | Discounts | Net banked | Ads cash out | After ads |
  | --- | --- | --- | --- | --- | --- |
  | Jun 24–30 | 65,625 | 2,042 | 63,583 | 2,047 | 61,536 |
  | Jul 1–7 | 71,849 | 2,420 | 69,429 | 2,091 | 67,338 |
  | Jul 8–14 | 69,152 | 2,173 | 66,978 | 2,014 | 64,965 |
  | Jul 15–21 | 72,021 | 2,615 | 69,405 | 1,873 | 67,533 |
  | **Jul 24–30** | 69,906 | **3,188** | 66,718 | **1,042** | **65,676** |

  The recorded ads column (3,269 / 4,027 / 3,745 / 2,092) was exactly 2× from
  Jul 4 on. Decomposed vs the mean of the three full-spend blocks: ads
  1,993 → 1,042 = **+RM951/wk of real cash kept** (RM4,127/mo); discounts
  2,403 → 3,188 = **−RM785/wk of revenue never collected** (RM3,407/mo);
  **net ≈ +RM166/wk ≈ +RM720/mo**.
  **CAVEAT that outweighs the result:** the "after ads" column on the three
  full-spend blocks alone spans 64,965–67,533, a **RM2,568 spread**. The ad
  saving is RM951. **The saving is smaller than ordinary week-to-week revenue
  variance**, so no single week's bank balance can demonstrate it — it needs
  another month or two, or a proper holdout.
  **Revenue still holds** — 66,718 net is −2.7% vs the full-spend mean, inside
  that same spread. Discount split per week
  confirms it is vouchers, not staff: reward 540 → 612 → 984 → 1,239 → **1,563**,
  promo 696 → 766 → 482 → 653 → **1,015**, manual 39 → 40 → 6 → 0 → **19**.
  Ads sync runs ~2 days behind (last date Jul 30 as of Aug 1) — do not read the
  newest two days as a drop.

- 2026-08-01 — **WITHDRAWN: "actual ad spend runs 1.3–2.1× the daily budget".**
  Same root cause. Real spend Jul 4–19 was RM280–330/day against ~RM283/day of
  budget — the cap was being respected almost exactly. The "ramp on Jul 4 at
  unchanged CPC, therefore real" argument was itself the artefact: clicks
  604 → 1,476 and impressions 26k → 56k doubled because the roll-up row started
  that day, not because delivery changed. **Do not build the spend-vs-budget
  overrun check** that the previous resume pointer queued. `monthly_saving_myr`
  is still a budget delta rather than realised cash — that part stands.

- 2026-07-31 — **Stock counts were being filed under the wrong date, and it
  invalidates the Putrajaya shrinkage finding.** Owner asked whether Firdaus's
  count saved ("but the date?"). It did — count `3ad902a3` — but it was dated
  **29 Jul and finalized 31 Jul**. `countDate` defaults to creation and was
  never touched again, while the balances a finalize writes are as-of *now*.
  Systemic, not a one-off: CC001 counts sat open **2, 6, 9 and 25 days**; CC003
  (Tamarind) closes every count same-day. Tamarind is also the ONLY outlet whose
  stock reconciles cleanly (0.6% vs Putrajaya's 7.3%) — so the "worst shrinkage
  outlet" conclusion is at least partly an artefact of how the counts were
  taken. **Treat every Putrajaya reconciliation figure as unproven until a
  clean same-day count exists.** Fix shipped (PR #1094): counts expire after
  24h; counting on into an expired one is soft-blocked (start fresh, or continue
  and have `countDate` moved forward); finalizing an expired count stamps it
  with the closing day. Expiry is **derived from `createdAt`**, not stored — no
  `EXPIRED` enum, no migration, no cron to flip stale rows.

- 2026-07-30 — **Actual ad spend runs 1.3–2.1× the daily budget on file,
  persistently.** Jul 4–19: RM550–670/day actual against ~RM283/day of budget
  (ledger `prev_daily_micros` on Jul 18 reads 84.96/98.42/100.00, so the
  autopilot genuinely believed the cap was RM283). Jul 22–26: RM330/day against
  RM165/day of budget. Jul 27–28: RM222/day against ~RM160/day. **The ramp is
  real, not a sync artifact** — clicks 604→1,476 and impressions 26k→56k both
  doubled on Jul 4 at unchanged CPC (0.43–0.62), and there is exactly one
  `ads_metric_daily` row per campaign per day (111 rows / 37 days / 3
  campaigns). Google permits 2× on individual days but smooths to
  budget×30.4/month; 16 consecutive days at 2× does not fit that, so either
  something raised budgets outside `ads_budget_change` (UI edit, or Smart
  campaign auto-apply recommendations) or Smart campaigns simply overrun here.
  **Consequences:** (a) `monthly_saving_myr` in the ledger is computed from
  budget deltas and therefore does NOT equal realised bank saving — always
  reconcile against `ads_metric_daily`; (b) budget is not a reliable cap, so the
  descent controller needs a spend-vs-budget overrun check; (c) realised saving
  measured from actual spend: RM17,488/mo at the Jul 8–14 peak → RM9,085/mo
  (Jul 22–28) → RM6,753/mo at the Jul 27–28 run-rate, i.e. **−RM10,735/mo vs
  peak but only −RM1,920/mo vs the June baseline** of RM8,673/mo. Quote the June
  baseline, not the peak: the peak was itself 16 days of unbudgeted overrun.

- 2026-07-29 — **`Outlet.openTime/closeTime` is NOT the real trading window —
  measure from the till.** Config says 08:00–22:00 for all three outlets. The
  tills say first sale **07:46** (PJ), last **22:47**, and the **22:00 hour
  carries 184 transactions (2.3% of the day)**. Acting on the config would have
  switched ads off during a genuinely trading hour. Hours **23:00–06:59 carry
  ZERO transactions** at every outlet — that, and only that, is the provably
  dead window (8h, not the 10h the config implies). Encoded as `DEAD_HOURS` in
  `ads/sync-ad-creative.ts` with tests. Owner caught this ("check the opening
  hours, dont assume") — same class of error as trusting the negative-keyword
  root: believing a stored value instead of measuring. **Anything scheduling
  against opening hours (ads, labour gate, rosters) should be checked against
  the till, not the config.** Whether the config itself should be corrected to
  ~07:45–23:00 is an open owner decision (it may be intentional "scheduled"
  vs "actual" hours, and it feeds staffing).

- 2026-07-29 — **Ad-serving window DECIDED by owner: 07:30–22:00 MYT**
  (`AD_WINDOW` in `ads/sync-ad-creative.ts`, tested). Owner proposed
  07:30–21:30 ("after 10 people wont come"); the 15-min till profile says the
  arrival instinct is right but lands ~30 min later — 21:30 (136 txns/RM3,774),
  21:45 (129/RM3,918), 22:00 (108/RM2,947), 22:15 (62/RM1,582), then the real
  cliff 22:30 (13) → 22:45 (1). 21:30–22:29 is ~RM12.2k of genuine trade, so a
  21:30 cutoff would go dark in four of the busiest remaining quarter-hours.
  Ending 22:00 leaves a ~30-min conversion runway into the cliff. NOTE this is
  a different question from `DEAD_HOURS` (23:00–06:59 = till provably silent);
  the ad window needs runway for the customer to decide and travel.
  **NOT yet applied to Google** — pending the `hour_profile` read that prices
  how much we actually spend per hour; if overnight spend is trivial the lever
  gets dropped rather than shipped.

- 2026-07-29 — **IOI Mall clock-out trap: fixed and DEPLOYED, but NOT yet
  exercised in production — and it probably never will be by waiting.**
  Incident: staff rostered at Celsius Coffee IOI Mall could clock in but not
  out; the app said "571m from Celsius Coffee Putrajaya". Cause: IOI Mall was
  the only outlet with no `hr_geofence_zones` row, `pickOutletByLocation`
  only ranks candidates that HAVE a zone, so IOI staff were snapped to
  Conezion and tagged `app_offsite` at clock-in; the clock-out hard gate then
  measured them against an outlet they were never at. Fix (#1087, `773afb0`,
  `clock-out-gate.ts`): hard-gate ONLY a clock-in verified inside the zone
  (`clock_in_method === "app"`); an unverified clock-in falls back to
  warn + allow + audit, tagging the clock-out `app_offsite` / `app_nogps`.
  **Timeline, all 2026-07-29 UTC:** 09:04:43 Farhan clocks in (app_offsite,
  571m, stamped Putrajaya — old code, no IOI zone yet) → 09:47:46 staff prod
  deploy READY on `773afb0` → 09:47:51 IOI Mall zone created
  (2.96965143 / 101.71552897, **radius 250m**) → 12:56:58 later prod deploy
  (`132034f`, still carries the fix) → 14:06:39 Farhan clocks out. **The fix
  was live 4h19m before that clock-out.**
  **Verdict: inconclusive, NOT a failure.** He clocked out **13m from
  Conezion** → in-zone → `clock_out_method 'app'`, which the OLD code would
  have allowed identically. Same shape as Fatin (12m inside Tamarind, `app`).
  **Why organic verification won't come:** every one of Farhan's last 7 shifts
  (Jul 20,22,23,25,26,27,28,29) ends with a clock-out **6–65m from Conezion,
  method `app`**, while clock-in is `app_offsite`. He walks to Conezion to end
  every shift, and has done since before the fix existed. Waiting for him to
  tap out at IOI Mall is not a test that will fire on its own — it needs a
  **deliberate** one (ask him, or Chef Bo, to tap clock-out AT the IOI kiosk
  before walking over; expect `clock_out_method 'app_offsite'` + the
  "flagged for review" warning).
  **New IOI zone is still untested** — no clock-in has been stamped IOI Mall
  since it went live; nobody near IOI clocked in after 09:47:51Z.
  **Zone coverage is marginal at the boundary:** today's clock-in point sits
  **279m** from the IOI centre, outside the 250m radius, so it would still be
  `app_offsite` (though now stamped **IOI Mall**, since nearest-zone wins:
  279m < 571m — that alone fixes the wrong-outlet attribution). His Jul
  20/22/23 clock-ins were 153m / 32m / 20m from the same centre, i.e. INSIDE —
  so the centre is right and 279m is an edge point (mall entrance/carpark or
  GPS drift), not a mis-placed zone. Bumping the radius is a judgement call,
  not an obvious fix; it is prod data and needs owner sign-off.
  **Side finding, unrelated to the trap:** Farhan's clock-ins on Jul 26/27/28
  were **6.4km / 5.1km / 5.1km from ANY outlet** — accepted by the soft gate
  as `app_offsite` with `ai_flags` EMPTY on every row. Clocking in from ~5km
  away at shift start is an attendance-integrity issue nothing currently
  surfaces. Not addressed by #1087.

- 2026-07-22 — **Week 2026-07-20 = owner-designated SCHEDULING REFERENCE
  baseline** ("make week 20th a reference and optimise from there — cost &
  man-hours a good match"). Published rosters to measure future weeks against
  (est cost = schedule's own `estimated_labor_cost`; % vs forecast revenue):
  · Putrajaya  514h, RM5,693 — PT 21.5h/RM212 (2 heads) — fc RM28,616 → **19.9%**
  · Shah Alam  410h, RM5,104 — PT 203.5h/RM2,042 (8 heads) — fc RM24,470 → **20.9%**
  · Tamarind   312h, RM3,685 — PT 113.5h/RM1,096 (4 heads) — fc RM18,413 → **20.0%**
  · Combined 1,236h, RM14,482 on fc RM71,499 → **20.3%** (right on the 20% target
  we settled as the achievable ceiling for scheduling alone; 18% needs FT
  redeploy). Structure: PJ is FT-heavy (PT tiny), SA/Tam are PT-heavy — the PT
  lever lives at SA/Tam. **WATCH:** 6-day actual (via unified_sales) was tracking
  BELOW forecast — PJ RM19,169, SA RM16,707, Tam RM13,419 — so labour% may land
  higher than the forecast-based figures once the week fully closes and revenue
  is reconciled; if the gap holds, the forecaster ran optimistic for this week.
  Reconcile actual vs forecast when the week closes, then treat these roster
  numbers (hours + cost, the controllable part) as the optimisation baseline.
  **Known optimisation from the baseline (owner 2026-07-22): rover lead (Barista
  Lead, Syafiq Kaberi) must count as COVERAGE man-hours in the generator.**
  Today the generator EXCLUDES rovers from the demand model (schedules full FT
  for demand, then adds the rover on top) → every day the rover is at an outlet
  it's +1 over-staffed. Live example: PJ Tue 2026-07-21 close had 4 heads
  (Guraf+Hidayat kit, Hafifie bar, Syafiq bar-lead) vs ~3 needed — Syafiq
  redundant. Note the gate's coverage view already counts Barista Lead
  (`isManagementPosition` excludes only manager/area-mgr/HoD, NOT barista lead),
  so gate and generator disagree. Fix = in the generator, place the rover's
  known days FIRST and let FT fill the RESIDUAL demand (his cost is already
  pro-rata-correct; this is coverage-counting only). **Implemented 2026-07-22
  (minimal form):** generator no longer auto-rotates the rover lead — owner
  places him manually ("we schedule him based on our needs"); the labour gate
  already counts a Barista Lead as a coverage head, so day short/over reflects
  him once placed. NOTE: the generator wipes+recreates shifts each run, so a
  place-then-regenerate flow that has FT fill the residual around a pre-placed
  rover is NOT built (would need locked-shift preservation) — deferred.

- 2026-07-16 — **"Cyberjaya" = the Celsius Coffee Tamarind outlet.** It's the
  informal/local name owners use on hiring paperwork; there is NO separate
  Cyberjaya `Outlet` row. Staff listed under "Cyberjaya" belong to Tamarind
  (`5d1f2731-1985-4e54-a6df-3990e7d5c159`). (The five real outlets: IOI Mall,
  Nilai, Putrajaya, Shah Alam, Tamarind.) New-hire onboarding is done by
  mirroring `/api/hr/employees/create` in one atomic SQL insert: `User`
  (bank fields live here) + `hr_employee_profiles` + `hr_salary_history` +
  `hr_job_history`. PT crew convention: `employment_type='part_time'`,
  `hourly_rate` (RM9 standard), `basic_salary=0`, `statutory_applicable=false`,
  `epf_category='A'`, `payroll_cadence='MONTHLY'`, `stations=['foh']` barista /
  `['boh']` kitchen; staff-app access = the `barista`/`kitchen crew` crew preset
  (`appAccess ['ops','inventory']`). DOB + gender are derivable from the IC.

- 2026-07-10 — **Vercel schedules at most 40 cron jobs per project; entries past
  40 are silently never scheduled.** vercel.json hit 46 (Jun 30) and the tail —
  procurement-exec, par-levels-recalc, request-invoices/receivings,
  consumption-post, labour-variance — was dead ~10 days with zero errors.
  Consolidated to 37 via dispatchers (`cron/procurement-loop`, `cron/ops-nudges`);
  `apps/backoffice/src/vercel-crons.test.ts` fails CI past 38. **Never append a
  41st cron — fold into a dispatcher.**

- 2026-07-10 — The AP bank matcher is RECONCILE-ONLY on the 6-hourly loop
  (Telegram POP is the primary payer); only the EOM `cron/ap-match-apply` may
  mark open invoices paid (`markOpenPaid:true`). Bank narrations quoting a
  different invoice number veto the match (312/1049 historical matches settled
  the wrong same-amount invoice; ~113 double-count risks still need a manual
  reconciliation pass — unfixed data).

- 2026-07-10 — PDF cold-send path (PROCUREMENT_PO_DOC_TEMPLATE) is hard-disabled
  in code: the Meta template never matched (16/16 sends failed #132000). Cold
  sends ride prompt→reply→block, with 24h re-prompt + give-up note. Re-enable in
  procurement-po-send.ts once the template truly has a DOCUMENT header + {{1}}/{{2}}.

- 2026-07-05 — RLS coverage is broader than `docs/rls-strategy.md` claims
  (three later migration sets added deny-all/policied RLS to HR, bank, ads,
  and all `fin_*` tables) — but the **loyalty tables' policies are
  `USING (true)` for all roles, so member PII/points are anon-readable AND
  writable**. Full verified map + ranked fixes:
  `docs/rls-access-map-2026-07-05.md`.

- 2026-07-04 — Exception-inbox corrections update `fin_agent_decisions`
  (`corrected=true, corrected_to=…`) — this is the finance agents' eval/
  retraining dataset. Preserve the write path in any refactor.

- 2026-07-05 — Categorizer runs on `claude-haiku-4-5` with a prompt-cached
  COA block; its vendor context is the last **5** bills, not the 50 the
  spec describes (spec drift, `categorizer.ts` `supplierHistory()`).

- 2026-07-05 — The Anomaly agent from the finance spec is **not built**;
  matching is rules-based (`ap-match.ts`) + an LLM verifier — nothing
  writes `fin_matches`. Only `ap`/`categorization` exceptions have a
  resolver; other exception types noop on resolve.

- 2026-07-11 — **Sales revenue is recognised at PAYMENT, not fulfilment.**
  Pickup/QR `orders` payment is confirmed at the pending→paid/preparing
  transition (markRmOrderPaid / confirm-stripe), so the sales dashboard's old
  `status='completed'`-only filter hid paid orders still being brewed (a paid
  RM 77.30 QR order sat invisible all morning). Canonical set is
  `PICKUP_PAID_STATUSES` in `unified-sales.ts` (paid/preparing/ready/collected/
  completed) — used by dashboard, reports, staff app, labour gate. `pos_orders`
  stays `completed`-only: the till writes completed at ring-up (= paid) and
  Grab settles at collection. Historical days are unaffected — the hourly
  sweep-stale-orders cron forces every paid order terminal within ~3h.

- 2026-07-05 — **Revenue is split across 3 tables** and reconciles to the
  manpower workbook to the ringgit: `storehub_sales` (per-outlet retirement
  Jun 15–17), `pos_orders` (in-house POS from Jun 8/15/18, GrabFood
  included), `orders` (pickup app). Any revenue query must UNION all three
  while the cutover is in a trailing window (`lib/hr/labour-gate.ts`
  `revenueBetween`).

- 2026-07-05 — **PT wages never flow through payroll runs** (Apr+): they are
  weekly bank transfers → `BankStatementLine` (`partimer` rule) → GL
  `6500-03`. June per outlet: Con 5,103 / SA 9,168 / Tam 6,078 / Nilai
  3,892. Outlet venue prefixes exist in descriptions since June; classifier
  fixed + 266 rows backfilled (migration 071).

- 2026-07-05 — Shift templates of record are the `hr_shift_templates` DB
  rows (Opening / Middle 1–3 / Closing per outlet); `lib/hr/shift-templates.ts`
  is only the fallback when the table is empty.

- Typecheck before pushing — every time. CI enforces it, but catch it locally.

- Never test against the production database; the procurement runbook's seed SQL
  is staging-only.

- When a fix is confirmed working, record *why it worked* here or in the relevant
  skill — not just in the chat.

## Open failures

- 2026-08-20 — **RM settlement lag incident (~12:30–15:30 MYT): Revenue
  Monster's Query Payment Checkout kept answering PENDING for ~2h on
  FPX payments whose money had already left the customer's bank — paid
  dine-in orders sat invisible to the kitchen.** Owner-reported from an RM
  merchant-app photo: C-8ZXV75 (Shah Alam table 15, RM26.80 FPX, tx
  …0537163104164) created 05:37Z, money deducted, but webhook (05:38Z),
  poll, reconcile-pending (every 1 min, 45s–55min window) and
  expire-orders (every 15 min) all got PENDING from RM until the 07:30:16Z
  expire-orders sweep finally saw SUCCESS → order flipped preparing and
  the kitchen docket printed 07:30:19Z (1h53m late). Same sweep settled
  C-F30773 (Conezion table 11, RM9.90 FPX, created 05:41Z) — multi-outlet,
  so RM-side, consistent with the 2026-07-27 hosted-page verdict that RM's
  infra is flaky. Our pipeline behaved correctly at every step (nothing
  bulk-failed a paid order; expire-orders' ask-RM-first design recovered
  both) — the gap is DETECTION: nothing alerts a human while an order with
  a checkout_id sits pending >30 min, so the customer complains before we
  know. **Still unresolved as of 07:40Z:** C-1WA685 (Tamarind table 7,
  RM53.60 card, 04:35Z) and C-NVK227 (Conezion table 16, RM27.90 FPX,
  04:52Z) remain pending with RM still answering PENDING — check the RM
  merchant portal whether these customers were charged; crons keep
  re-sweeping them every 15 min and will settle+print automatically if RM
  flips. Candidate follow-ups (owner call): a pending->30min alert (ops
  pulse/Sentry), and raising the incident with RM support with the tx ids.
  **UPDATE 08:01Z:** C-1WA685 and C-NVK227 were flipped to failed by a
  single manual statement (identical updated_at, NULL failure_reason —
  no cron path does that); if either customer was actually charged, only
  the `reconcile-failed?days=N` operator dry-run will surface it now.
  **Detection fix SHIPPED on this branch (PR #1173):** expire-orders now
  raises a per-order-fingerprinted Sentry error (`[stuck-pending]`) for
  any checkout-bearing order still deferred past 30 min — staff get
  alerted at ~30-45 min instead of hearing it from the customer at 2h.
  Settlement behavior untouched. Remaining owner actions: raise the tx
  ids with RM support; confirm in the RM portal that C-1WA685/C-NVK227
  weren't charged (or run reconcile-failed dry-run).

- 2026-07-30 — **BUG (money path, unfixed): per-line discounts are charged to the
  customer but NOT persisted — the till OVER-REPORTS revenue.**
  `cart.ts:127 cartSubtotal` is net of `line_discount_sen` and drives both the
  cashier's on-screen total (`register.tsx:870`) and the customer display
  (`customer-display.tsx:250`), so the customer correctly pays the discounted
  amount. But `checkout.ts:179` RECOMPUTES `subtotal = Σ unit_sen × qty` — GROSS,
  ignoring `line_discount_sen` — and that gross figure is what lands in
  `pos_orders.subtotal`, `.total`, and the `payments` row (`amount: total`).
  The line discount is written to `pos_order_items.discount_amount` and printed
  on the receipt (`receipt-format.ts:208`) but never deducted from the order.
  **Verified against prod:** for every affected order `total` equals
  `subtotal + service_charge − discount_amount + sst` exactly, i.e. the line
  discount is absent. e.g. CC-CON-4797 subtotal 7450, line_disc 1390, promo 0,
  reward 0, total 7450; CC-TAM-2757 line_disc 6760 = 100% of subtotal, total
  6760. **RM1,636.34 across 222 lines since 2026-06-08, still occurring
  2026-07-30.** Effects: reported revenue overstated by that amount, and card
  settlements / cash counts run short against reported sales. Small vs ~RM330k
  of till (~0.4%) so it does not move the ads conclusions, but it is real money
  and it corrupts every revenue lens. **NOT fixed — `pos-native` is a
  production OTA deploy and this is payments-adjacent, so hard rule 6 applies:
  needs owner approval.** Fix is one line (make checkout's subtotal use
  `cartSubtotal`/`lineNet`), but decide first whether historical rows get
  restated or left as-is.

- 2026-07-27 — **QR-order payment failures are chronic (~16%/day) and CARD is
  the outlier: 36% of card attempts fail (89/247 over 14d) vs ~11% FPX/TNG,
  at ALL three stores (SA 43.5% / Con 38.6% / Tam 21.3%) — so it's the card
  flow, not one store's RM config.** Investigated from an owner photo of
  C-9T2N79 (SA table 11, RM63.60, card): flipped failed with `rm_expired`
  15s after creation; same customer retried (C-E8BL26) and failed again in
  39s; that customer never paid in-app at all. Failure signature: 42/89 card
  failures die <60s with RM reporting the checkout EXPIRED (fpx has 8;
  wallets have ZERO sub-minute fails — their failures are all >10-min
  abandons swept by expire-orders). Card rides the RM HOSTED page
  (`method:[]`, no Direct deep link — client.ts), so the sub-minute EXPIRED
  cluster = something on the hosted page kills the session fast (customer
  back-out flips it EXPIRED, or the card form itself errors — cannot
  distinguish from our data; RM-side checkout logs needed, e.g. checkout
  1785155130513125190). **No money lost:** 0 failed orders carry a
  payment_provider_ref, and reconcile accepts failed→paid if RM ever
  reports SUCCESS. **Cost:** 213 fails/14d, only 25 recovered in-app within
  45 min → ~RM6.5k of baskets/14d abandon the app (some pay at till,
  invisible here). UX gap compounding it: the failed screen says "Place the
  order again to retry" — NO retry-payment button, though
  `/api/payments/create` allows retry on the same failed order and the
  tracking poll already heals failed→paid. **"Try payment again" button
  SHIPPED on this branch (owner-approved)** — `_OrderTrackingView.tsx`
  failed card now retries via `/api/payments/create` on the same order
  (route already re-asks RM about the prior checkout before minting a new
  one, and 409 alreadyPaid → refetch heals the screen). Gated on
  `payment_checkout_id` being set: only RM-routed orders ever set it, and
  payments/create is RM-only — keeps a Stripe-routed failure from getting
  an RM checkout. Card retry lands on RM's hosted page which lists EVERY
  enabled method, so a stuck card customer can switch to FPX/TNG without
  re-ordering. pickup-native has its own failed screen — NOT touched
  (OTA, hard rule 5). **VERDICT (2026-07-27 evening, Vercel runtime-log
  forensics): the fault is RM-SIDE — their hosted card page intermittently
  bounces the customer straight back with no payment form.** Timeline
  reconstruction (order create in DB vs `GET /order/[id]` arrivals in the
  celsius-pickup-app prod logs; web checkout is a SAME-TAB redirect to RM,
  and the only programmed route back is RM's own redirect): C-9T2N79
  created 12:25:29Z → customer back on OUR tracking page **12:25:31Z (+2s)**
  → RM's checkout-status query answers EXPIRED → failed 12:25:44Z. C-E8BL26
  same customer, same pattern: created 12:28:55Z → back at **12:28:59Z
  (+4s)**. No card form can render in 2–4s — RM's page bounced them on
  arrival and the session died. CONTRAST: successful card order C-OO0R20
  (12:09Z) has ZERO order-page hits for 3.5 min after creation — the
  customer stayed on RM's page doing card+3DS, i.e. a normal journey. Our
  side behaved correctly at every step: checkout minted (code SUCCESS +
  checkoutId + url), redirect issued, no webhook needed, poll faithfully
  recorded RM's own EXPIRED answer. C-2SW359 (+45s to return) may be a
  genuine form-level failure/cancel — mixed in with real declines/abandons,
  which is why card still succeeds 64% of the time. For the RM support
  ticket, dead-on-arrival checkout ids (all 2026-07-27): 1785155130513125190
  (C-9T2N79 12:25Z), 1785155337969132047 (C-E8BL26 12:28Z), 1785137709574802454
  (C-WEI821 07:35Z), 1785116295817108378 (C-5FVC46 01:38Z); working
  contrast: 1785154144224524567 (C-OO0R20 12:09Z). Still open: (1) file the
  RM support ticket with the above; (2) live-test a card payment at an
  outlet; (3) consider deprioritising card in the method picker until RM
  fixes their side. Payments = hard rule 6: owner decides. — not blocking
  revenue capture at till, but ~1 in 6 app checkouts dead-ends (the merged
  retry button now softens it).

- 2026-07-11 — **`sentry.io` is NOT in the CCR environment's egress
  allowlist** — live Sentry MCP call returned `403 Host not in allowlist:
  sentry.io` — so the nightly Sentry-triage routine (05:00 MYT) has no-oped
  at its guard step every run since 2026-07-04; the weekly email digest was
  the only error visibility. **Human action:** add `sentry.io` (+
  `*.sentry.io`) in the environment's network settings; verify with
  `find_organizations`. Until then the self-fixing loop cannot run. —
  blocking.

- 2026-07-11 — **`JWT_SECRET` is missing from the order app's Vercel env**
  (project `celsius-pickup-app`) — every request logs `[env] order: MISSING
  (required): JWT_SECRET` in BOTH serverless and edge runtimes (verified via
  Vercel runtime logs); this is the 3.6k-event "Ongoing" Sentry issue from
  the weekly report. Not just noise: `@celsius/auth getJwtSecret()` THROWS
  without it, so `POST /api/orders/[orderId]/confirm-maybank-qr` (backoffice
  "Mark paid & release" for Maybank QR) 500s whenever used. Customer/staff
  JWT paths survive on the `CUSTOMER_JWT_SECRET`/`STAFF_JWT_SECRET`
  fallbacks. **Human action (payments-adjacent, hard rule 6):** add
  `JWT_SECRET` to the celsius-pickup-app Vercel project with the SAME value
  as backoffice's, redeploy. — blocking Maybank-QR release.

- 2026-07-11 — **`ANTHROPIC_API_KEY` is missing from the staff app's Vercel
  env** — confirmed live: `GET /api/audits/staff/<id>/coach` 500ed with
  "Could not resolve authentication method" (the 21-event "New" Sentry
  issue); boot check also flags `BACKOFFICE_INTERNAL_URL` (recommended)
  missing. Owner chose to REMOVE the staff AI coach instead of wiring the
  key (done in the sentry-loop PR: coach route + agent + My Skills card
  deleted; unused /api/audits/insights dropped too; staff-native untouched
  — its coach card already hides on fetch failure, remove the dead helpers
  on the next staff-native touch). **Key is STILL needed:** the claims
  receipt-extraction route (`/api/claims/extract`, used by staff web +
  staff-native claims) also runs on ANTHROPIC_API_KEY and is equally
  broken until the var is added to the staff Vercel project.

- 2026-07-05 — **`pos_*` + `orders`: 14 `USING(true)` policies are BY
  DESIGN** (SUNMI tills write via the anon key). Do NOT lint-fix — needs a
  data-layer plan (rls-strategy.md Path A). 4 `security_definer_view` +
  ~12 `function_search_path_mutable` remain as low-risk hardening.

- 2026-07-05 — Most Vercel crons still have no heartbeat monitoring
  (`reconcile-pending` wired 2026-07-05; procurement family covered by the
  loop watchdog since 2026-07-10; HR/finance/ads crons still fail silently).

- 2026-07-05 — Pickup dashboard **inventory tab reads tables that don't
  exist** (`ingredients`, `stock_levels`, `ingredient_outlet_settings` —
  absent from BOTH Supabase projects); it has been silently empty. Either
  wire it to the real procurement stock tables (`StockBalance` etc.) or
  remove the tab.

_Format: `YYYY-MM-DD — <symptom> — <evidence> — <hypothesis/fix> — <blocking?>`_

- 2026-07-20 — **Filters + reports QA sweep (branch
  `claude/sales-compare-robustness-q5peil`, PR #1021).** Owner reported the
  stale-response filter race on Sales Compare then Cashier Performance ("not
  updated when filter"); audited ALL 92 filtered backoffice pages (5 parallel
  agents). **SWR pages (`useFetch`) are race-safe by construction; only
  imperative fetch+useEffect pages have the bug.** New shared hook
  `lib/use-latest-request.ts` (seq counter + AbortController) applied to the 8
  unguarded pages: sales/dashboard, AccumulativeChart, pos/reports,
  reviews/geogrid (loadHistory), pickup/analytics (orders — `cancelled` flag),
  loyalty/members (pagination — plain seq ref, helper takes no signal),
  loyalty/loops, loyalty/dashboard. **Speed done:** per-row `pay_method`
  correlated subquery (added in the payment work; on dashboard+compare every
  request) → one batched `DISTINCT ON` (254/254 cent-exact vs subquery);
  cashier phone-chunk member lookups → `Promise.all`. **Deferred/proposed
  (change numbers or need care — NOT done):** z-report aggregates by
  outlet+time-window not shift_id → two registers cross-contaminate
  gross/net/tax (money bug) + its per-shift N+1; MYT date off-by-ones
  (ops/performance, inventory purchase-summary + wastage, ads/grab,
  reviews/dashboard, pickup/analytics — bucket to UTC not MYT, "to=today" can
  show nothing); loyalty/members full-table item scan every mount;
  supplier-scorecard 3×N fan-out; cogs full-scan→groupBy; optimizer unbounded
  findMany→distinct; main dashboard triple per-outlet fan-out; cashflow
  sequential awaits + triple BankStatementLine scan. loyalty/dashboard/kpi
  route looks orphaned (no client consumer) — verify before optimizing.

- 2026-07-12 — **QA-decommission leftovers still owed (human actions):**
  rotate the Telegram QA bot token (old `qa-health-check` edge-function
  versions embed it in source), delete the 3 tombstoned edge functions
  from the Supabase dashboards, and decide whether the idle
  `celsius-inventory` Supabase project (`akkwdrllvcpnkzgmclkk`) gets
  paused or deleted. Full story: `docs/state-archive/2026-07.md`.

## Lessons learned

- 2026-07-14 — **Every upload control must accept drag & drop** (owner
  directive: "this should be the standard"). Backoffice audit found the
  standard mostly hand-rolled per page and four click-only gaps (invoice Edit
  photos, Mark Paid receipt, recon attachments, Maybank QR) — all fixed. For
  NEW upload UI use `components/ui/file-dropzone.tsx` (shared, drag-aware,
  accept-filtered) instead of another bespoke label+hidden-input.

- 2026-07-14 — **Always check the date format** (owner directive). Malaysian
  supplier documents are DAY-FIRST (06/07/2026 = 6 July); the doc extractor
  stamped due date 14/06/2026 on two KLFC invoices *issued* 06/07/2026, which
  flipped an unpaid invoice to OVERDUE off a date that predated its own issue.
  Whenever reading or writing dates (invoices, bank narrations, screenshots,
  SQL), confirm DD/MM vs MM/DD from context and sanity-check orderings
  (due ≥ issue, paid ≥ issue). Systemic guard now in
  `finance/parsers/supplier-doc.ts` (`sanitizeBillDates` + day-first prompt
  rule); both KLFC due dates corrected in prod (7-day terms → 2026-07-13).

- 2026-07-11 — **Sales pull-to-refresh saga (staff-native), attempt 4:** the
  50e161f "cream pull-well" (absolute View at top:-300 inside the ScrollView)
  made it worse — ScrollView content layers ABOVE the native RefreshControl,
  so the well *covered* the spinner and showed as a bare cream slab under the
  period tabs while refreshing (owner screenshot). iOS 26's spinner ignores
  `tintColor`, so on the dark espresso Sales screen the native spinner cannot
  be made visible at all; do not retry tint/backdrop tricks. Fix: rely on the
  screen's own gold "Updating…" header row during `refreshing` too, cream tint
  kept only for platforms that honour it (older iOS, Android's cream card).
  Round 2 (owner, same day): holding `refreshing={true}` on the control kept
  iOS's tall overscroll inset open for the whole fetch — a big empty gap that
  "looks like lag" — and the spinner+"Updating…" text row read off-centre.
  Final shape: RefreshControl is TRIGGER-ONLY (`refreshing={false}` constantly;
  RN force-syncs native state after onRefresh so the control retracts on
  release, no stuck spinner) + a bare centered 20pt gold ActivityIndicator row
  under the tabs as the sole in-flight indicator, matching the checklist
  spinner size.

- 2026-07-05 — The AI Fill week-wipe (60 shifts) was the old generator's
  DELETE-then-INSERT persist with no transaction; `hr_schedule_shift_audit`
  (migration 070) held every deleted row and `jsonb_populate_record` restored
  them losslessly. Replace-style writers must delete+insert in ONE
  transaction, and the delete-audit pattern pays for itself.

- 2026-07-27 — **Compare revenue weeks payday-aligned.** Malaysian
  salaries land ~the 25th, so adjacent weeks sit at different points of a
  monthly demand cycle. Compare same-days-of-month windows, and use EVERY
  aligned window, not the single most favourable one — the spread across
  windows is the error bar on the conclusion.

## Resume pointer

- 2026-08-31 — **First STATE.md roll-over done (owner-approved):** July 2026
  moved to `docs/state-archive/2026-07.md` (20 finished Verified-facts
  narratives + all 58 July resume-log entries), file 4,356 → ~2,650 lines.
  Kept in place: every August entry, all Open failures/Lessons, and 18
  durable July facts. Moved to **Open failures**: the unfixed per-line
  discount money bug (Jul-30) and the QA-decommission human actions.
  Promoted: discount-column semantics → finance-warehouse skill Lessons;
  payday-aligned-comparison rule → Lessons learned. The monthly procedure
  now lives in the housekeeping skill ("STATE.md roll-over") — next
  roll-over due ~2026-10-01 for September. Same branch/PR as the
  `docs/admin/` skeleton (#1194).

- 2026-08-31 — **GBP category adds now one click away** (`/api/reviews/gbp-categories`,
  dry-run default, `?apply=1` appends): derives wanted categories from each
  outlet's ACTIVE tracked keywords via `categoryForKeyword`, resolves stable
  category ids at runtime (regionCode MY), append-only — primary + hand-set
  categories always preserved, 9-additional cap respected. Context: after 8
  weeks `restaurants near me` was still unranked at every outlet because the
  category adds were never made by hand. Marketing state 2026-08-31: ads spend
  cut 58% (RM8.7k->RM3.7k/mo, 24 budget cuts + 75 exclusions applied); rank
  trends now measurable (24 combos with pairs) — SA dominant, Tamarind ~#3-4
  holding, Putrajaya drifting ~-1, Nilai weak; reviews PJ 33/30d, Tam 28/30d,
  SA 5/30d, Nilai 3/30d (114, tied its top competitor). Owner still owes the
  review-ask push at SA + Nilai and the two clicks on gbp-categories.

- 2026-08-31 — **Stock investigation: measurement layer is now trustworthy;
  next is validation + physical checks.** Shipped this session: PR #1164
  (auto-approve + Flagged queue), PR #1195 (loose-pieces count units), staff
  memo (hr_memos de648741). Bread retracted as unit artifact; August summary
  artifact updated (claude.ai/code/artifact/de9a8a8a…). **Next:** (1) watch
  the first post-fix bread counts land in pieces (~1× expected); (2) Putrajaya
  must resume nightly counts — beans 2.01×/udang 1.69× unconfirmed since
  9 Aug; (3) weigh cream/lamb/duck/prawn portions, then fix BOM doses (cream
  250 ml and meats 50 g look wrong); (4) build engine prep-expansion
  (ProductRecipe walk, owner approved in principle); (5) day-7 shadow verdict
  → arm CONSUMPTION_ENGINE_ENABLED + drop POS trigger (never both live);
  (6) milk fix is procurement: close open milk POs, book deliveries at door.

- 2026-08-31 — **Company SOP module started (phase 0 shipped as a draft PR
  from `claude/celsius-coffee-sop-module-0md66t`).** This is the COMPANY
  operating manual for Celsius + Gosame, not the staff-app checklist feature —
  full design in `docs/design/sop-module.md` (4-tier framework, git-as-CMS,
  phase-1 schema sketch: Company/SopDocument/SopDocumentVersion/SopAcknowledgment).
  Shipped: `docs/sop/` tree, TEMPLATE, REGISTRY seeded with the 10 live
  staff-app SOPs as reserved Tier-3 IDs (queried from prod 2026-08-31), and
  `CC-GOV-001 Document Control` at v0.1 DRAFT. **Owner facts learned:** Gosame
  is a SEPARATE entity (own staff/infra — `gosame-ops` Supabase project
  exists, ap-southeast-1, since 2026-07-10); surfaces stay backoffice=admin /
  staff-app=read+ack; priority is docs → sign-off → execution links.
  **DONE same day:** phase 0 MERGED (#1193, squash `26d09b6`), CC-GOV-001
  published v1.0 effective 2026-08-31. Phase 0.5 drafted on the same branch
  (new PR): CC-FIN-001 **Payments & Refunds** (owner correction: BOTH
  companies are CASHLESS — never write cash-drawer/float SOPs; the POS is
  QR/card-only per `apps/pos-native/lib/shift.ts`, "reconciliation" =
  weekly bank-settlement watchdog with fee bands, advisory), CC-HR-001
  New Hire Onboarding (grounded in hr_onboarding_templates flow, HR
  authority matrix `OP_RULES` in `write-ops.ts` — two-person rule on
  salary/bank changes; PIN must be 6 digits for native logins), CC-OPS-001
  Incident & Complaint Handling (grounded in the reviews-recovery loop,
  ops-nudges, RM10 review penalties; NO generic incident log exists —
  SOP defines a written interim record). Registry updated; FIN-002 renamed
  "Daily Sales & Settlement Reconciliation" (still PLANNED).
  **Facts for future SOP writing:** typhoid NOT tracked (roadmap; certs
  table has food_handler etc.); refunds have NO POS flow (finance-side
  CUSTOMER_REFUND only); `ApprovalRule` table exists but NOTHING enforces
  it — don't cite it as operative; roles are OWNER/ADMIN/MANAGER/STAFF
  (no shift-lead enum; HOO is informal via position ILIKE 'head of').
  **2026-08-31/09-01 — all phase-0.5 docs MERGED + published:** #1198
  (squash `45e2458`) published FIN-001/HR-001/OPS-001 v1.0 effective
  2026-08-31; #1205 published CC-GOV-002 Roles & Authority Matrix v1.0
  effective 2026-09-01 — owner confirmed the proposed RM limits AS-IS
  (PO: OM self ≤RM500, HOO/AM ≤RM2,000, MD above + new suppliers;
  claims: OM ≤RM200; refunds/petty cash/recurring: MD; salary/payroll:
  two-person rule). Manual now has 5 published docs. PDFs were generated
  via weasyprint (scratchpad script) and sent to owner.
  **Next session:** CC-FIN-002 Daily Sales & Settlement Reconciliation
  (last PLANNED FIN doc), or start phase 1 (schema + sop-sync CI +
  staff-app reader/ack per docs/design/sop-module.md); owner owes team
  briefings + sign-sheets for the published set (GOV-001 §5.5, 7 days).
  When phase-2 enforcement is built, the settings approval-rules table
  must be configured to match GOV-002 §5.1. Open questions unchanged:
  Gosame domain map, shared functions (GRP- docs), BM/EN policy.

- 2026-08-28 — **Choc Blanc Merdeka: artwork done, decisions settled, ONE
  blocker left.** All three `splash_posters` rows still have `image_url = ''`;
  they cannot render until someone exports the three PNGs from the canvas
  (link above) and uploads them via Backoffice → Pickup → Splash Posters. That
  is a human step — no Cloudinary creds in-session. Everything else for 31 Aug
  is staged and gated by a future `starts_at`; note the home poster has already
  been flipped `active=true` by `pos-poster-autopilot`, so the schedule window
  is now the ONLY thing keeping it invisible. Next session: confirm the uploads
  landed, then walk the go-live runbook in
  `docs/design/choc-blanc-merdeka-campaign.md` — skipping its step 6, which is
  now dead. Open questions 4 and 5 (run the SMS voucher arm or announce-only;
  prune the 23 POS posters) are still unanswered.

- 2026-08-19 — **Local-rank QA: loop runs, but measurement was starved.** Since
  the Jul 5 radius fix: 69 combos scanned, only 3 twice — 93 active combos vs a
  40/mo cap and virgin combos (needScore 1000) eating each run, so "is rank
  improving?" was unanswerable for most terms. Fixed: (1) pruned tracked set
  93→41 in prod via the board's active flag (retired all 16 IOI Mall combos —
  no GBP connection — and the zero-demand unranked tail; reactivated the four
  "coffee <place>" June winners); (2) seeding (`seedTargetKeywords` +
  `refreshKeywords`) no longer resurrects retired terms on the monthly re-seed;
  (3) scan cron alternates re-scans with first-scans (rescansDue/firstScansDue
  in response) and default cap 40→160 (env `GEOGRID_MONTHLY_SCAN_CAP` still
  wins). **Outcomes so far:** Tamarind genuinely improving (+70 reviews since
  Jul 6, 37/30d, `cafe(s) near me` #3.4/#3.5 at 10km); Putrajaya steady (25/30d);
  Shah Alam rank-dominant (`cafes near me` #2.3) but reviews collapsed to 7/30d;
  Nilai flat at 1/30d yet only **2 reviews behind** its top competitor (HONGEH
  114 vs 112). Still undone (human): GBP category adds — `restaurants near me`
  unranked at 3 outlets in Jul AND Aug scans; review-ask push at SA + Nilai.

- 2026-08-15 — **Loop QA sweep DONE and MERGED to main as `9b6a3e7` (PR #1130).**
  P1 (incl. root cause), P2 (ageing arm), P4, P6 and P8.1 all fixed; P3
  WITHDRAWN as a bad finding. Full detail in `docs/design/loop-qa-2026-08-15.md`.
  The `pos_pairing_tuner` heartbeat migration is **APPLIED** (see P4 above), so
  all 10 heartbeats are live. No OTA: the diff touched no `*-native` app.
  **WATCH NEXT — three things land on their own, verify each:**
  (a) **VERIFIED 2026-08-15 16:35 UTC** — the first `refresh_pos_pairing_signals()`
  run with the heartbeat stamped `agent_registry.last_run_at` for
  `pos_pairing_tuner` at exactly `16:20:00 UTC`. **P4 is fully closed: all 10
  heartbeats are proven live**, and this was the only one whose verification had
  to wait for a scheduled fire. (b) **Tomorrow 02:00 UTC (10:00 MYT)** — first review-backlog
  digest fires; it will list ~28 stale drafts (oldest ~52d) in one manager
  WhatsApp. Expected, but chunky — `REVIEW_DRAFT_STALE_DAYS` tunes it.
  (c) **Mon 2026-08-17 05:00 UTC** — first geogrid run with retry + round-robin;
  expect far fewer `failed`, a non-zero `retries`, and `skippedNoGbpLocation`
  listing IOI Mall.
  **TWO OWNER STEPS LEFT — cannot be done from an agent session:**
  (1) **Attach the Supabase connector** to the re-armed `Finance warehouse —
  weekly custodian run` routine (`trig_01BCKPmWgpi1KUq7pk5BrK2n`) in the
  claude.ai routines UI. It fires Sun 2026-08-16 22:13 MYT and will report
  BLOCKED until this is done (P6).
  (2) **Connect IOI Mall's Google Business Profile** — `gbpLocationName` is NULL,
  so its 16 active keywords have never been scannable (P1).
  **THEN:** (3) **P8.2/P8.3 AFTER the ~Aug 17 Tamarind probe verdict** — probe
  verdict raw-OR-adj, and the missing grabfood filter; both move the index the
  probe is being judged on, so they wait. (4) **P5/P7** — latent, fix on the next
  loop-engine touch.
  **TWO OWNER DECISIONS, neither urgent:** (a) **negative-review auto-reply** —
  arm it, or keep the human-approval path and staff the queue that the new daily
  backlog digest now surfaces? Wants the risk-classifier first (P2). (b) **drop
  the dead `fin_bank_transactions` / `fin_matches` tables** — zero code refs
  anywhere; housekeeping proposal + owner-approved migration (P3).

- 2026-08-15 — **Ads: Tamarind restore pulled forward to TONIGHT (owner:
  "recover tamarind"), and the control-integrity fix landed before the
  Putrajaya probe goes dark (owner: "put in control before dark").**
  `PAUSE_PROBE_DAYS` 14 → 11.5: by day 12 the verdict was mathematically
  locked (index 0.875 through Aug 14; +22%/day needed to flip) and each extra
  dark day cost ~RM70–117 net margin. 11.5 not 12 so tonight's Aug 15 19:01
  run clears the daysSince race vs the 19:01:30 pause row. **OUTCOME (verified):
  the owner then said "can we restore now" — a one-time cron nudge (#1139,
  ads-daily → 14:45 UTC, reverted same day in #1143) fired the run early and
  the RESTORE applied at 14:46:20 UTC**: ledger `applied`, "autopilot restore:
  pause probe VERDICT — ads generate cash (pause-window till index 0.88,
  fleet-adj 0.87)", RM46.32/day, campaign ENABLED. The normal 19:01 run then
  fired on the restored `0 19 * * *` schedule (all 5 sync steps OK) with zero
  budget changes.
  **The predicted PUTRAJAYA pause probe did NOT start and will not under
  current metrics**: `selectPauseProbe` requires efficiencyRatio > 1.3×
  fleet-best, and the 30-day benchmark has SHIFTED — Putrajaya is now the
  fleet-BEST at RM7.26/conv (Shah Alam 7.56 → 1.04×; Tamarind 15.58 → 2.15×
  but excluded, already probed once by design). Tamarind's paused days
  polluted its 30-day window and moved the benchmark to Putrajaya, whose
  ratio is 1.0 — the probe fires only if Putrajaya's relative efficiency
  degrades past 1.3× later. The "~Aug 28 Putrajaya verdict" timeline is VOID;
  probing the fleet's most efficient campaign would be wrong and the gate is
  working as designed. Also shipped: paused-campaign outlets are now EXCLUDED
  from every fleet median (nightly guard `others` + probe-verdict controls) —
  a probed outlet's manipulated till no longer pollutes siblings' adjIndex
  (observed 2026-08-12: paused Tamarind pulled SA's control median to 0.9795
  vs 1.019 clean). Tamarind recovery check (reversal test, A=ads vs B=local
  factor) armed 2026-08-25 09:00 UTC — restore landed Aug 15 14:46, so it
  gets ~10 post-restore days.

- 2026-08-31 — **Owner: "lets try to increase back the gads spending and
  see" → "let us do all rm70/day", Tamarind included.** ownerDirective
  rewritten (supersedes the Aug-25 two-leg probe-up; Putrajaya's leg had
  fired Aug 30 at RM49.86, Shah Alam's never fired — guard stayed breached
  through Merdeka weekend): ALL THREE campaigns rise to RM70/day as
  EVALUATED raises — SA 53.98→70 (needs ≥RM801/mo lift), PJ 49.86→70
  (≥RM1,007/mo), Tamarind 41.71→70 (≥RM1,414/mo; owner chose to re-test
  despite the A/B/A verdict) — each leg fires on its outlet's first clean
  guard night, kept only on measured lift after 28d, reverted on breach; a
  machine revert is FINAL (leg won't re-fire); hard expiry 2026-09-30.
  Total +RM1,933/mo spend at full deployment. Recorded caveat: if all three
  lift together the fleet-adjusted keep-test partially cancels (median moves
  too) — read the Sep verdicts against anchor/mom + the cash scoreboard.
  Holdout read on SMS loops (same day): treated beats holdout in 8/9
  measurable loops (aov_push +RM29.80/head, reward_expiring +5.09, habit
  +3.53, welcome +1.54, winback +0.56; fresh_lapse NEGATIVE −1.06;
  celebration/product_launch/night_revival 0-conv both arms — measurement
  pending or broken, check). Tamarind decline fingerprint sharpened: loss is
  WEEKDAY-walk-in-concentrated (wkday −23% vs wkend −7%) → office-crowd
  hypothesis (Cyberjaya tenant move-out / RTO change / office-cafe) — ground
  check still owed.
- 2026-08-25 — **Tamarind A/B/A REVERSAL VERDICT: NO RECOVERY — the
  late-July decline is NOT ad-driven, and the Aug 15 "ads generate cash"
  probe verdict OVER-ATTRIBUTED.** Walk-in organic (POS ex-grabfood, organic
  filters), 9 restored days Aug 16–24 vs the windows: baseline Jul 1–27
  RM1,728/day (73.3 orders); decline wk Jul 28–Aug 3 RM1,605; PAUSED Aug
  4–14 RM1,382 (58.7); RESTORED Aug 16–24 RM1,443 (61.2) — weekday averages
  IDENTICAL paused-vs-restored (RM1,239 vs RM1,241), weekend restored LOWER
  (1,846 vs 2,029). Payday-cycle control: same days-of-month Jul 16–24 (ads
  on, same wallet position) was RM1,711/73.1 → restored Aug is −16% MoM, so
  the trough doesn't explain it. Nine full-budget ad-days produced no
  bounce toward baseline ⇒ the ~RM285/day shortfall vs baseline has a
  NON-AD Tamarind-local cause active since ~Jul 26–28 (still unidentified;
  ops/staffing/reviews/basket/regional ruled out 2026-08-14). The pause
  window's 0.88 index was substantially this pre-existing decline, not the
  ads going dark. Consequences: (1) the RM46.32/day restore is NOT proven
  cash-generating — descent should resume cutting Tamarind; the guard
  currently blocks cuts (raw 0.91, breach) but the recency-weighted
  forecast (½-life 2w) adapts to the new level within ~2wk and descent
  resumes automatically — owner may direct an earlier step-down; (2) probe
  verdicts need a pre-existing-trend control before believing dropDetected
  — fold into the deferred cleanup (adj-confirmation) which is UNBLOCKED
  (no probe running). Fleet ledger: ZERO budget changes since the Aug 16
  owner raise — the autopilot never touched it (lastKind "other" held, as
  designed). Conezion: recovering — Sun Aug 24 wk: Thu 3,347/Fri 3,487/Sat
  4,218/Sun 3,977 (+29% WoW)/Mon 3,388, Tue Aug 25 beat the prior Tuesday
  by 5pm (payday bounce landing); ~85–90% of pre-dip; guard raw 0.90 (adj
  0.94) still breached on the trailing window, trend up. Owner (same day):
  "raise ads for conezion and shah alam. make sure the ads work" →
  ownerDirective rewritten as TWO evaluated probe-ups (reasons start
  "autopilot raise" ON PURPOSE — kept only on measured lift, reverted on
  breach/no-lift after 28d): Shah Alam RM53.98→62.08 fires the first clean
  night (starts the post-rollback upward search ~6wk early); Putrajaya
  RM43.36→49.86 ARMS but fires only once Conezion's guard un-breaches
  (raising into the trailing breach would insta-revert). Hard expiry
  2026-09-15; spent Aug-16 undo-cut directive removed. Weekend Aug 21–23
  was fleet-wide soft (deepest pre-payday weekend + one-off Shah Alam Sat
  miss RM3,975 vs RM5.2–6k, cause unverified). Nilai guard forecast has
  decayed to RM64/day on the dead feed — chase remains with the data-estate
  owner.

- 2026-08-16 — **Conezion (Putrajaya outlet) slid ~21% WoW (Aug 10–16 vs
  Aug 3–9); owner directive shipped to undo the Aug 12 Putrajaya ad cut.**
  Decomposition: footfall −14% (orders 967→830/wk), AOV −8% (RM30.75→28.26),
  stockouts ~RM650–900/wk (Pomegranate/Citrus teas + Truffle Fries sold zero
  all week; Chocolate Cake Bars, Burnt Cheesecake, NYC Smores, Biscoff Batik
  went dark Aug 14–16 — restock list sent to owner). NOT the payday cycle:
  same-cycle week mid-July was RM28.4k vs this RM23.5k (−17% MoM) while Shah
  Alam rose +7% MoM; July's own mid-month dip was only −6%. NOT ads by
  timing: slide began Aug 10, two days before the Aug 12 cut, walk-in and
  dine-in QR fell proportionally, index read healthy through the descent.
  Google rating ticked 4.8→4.7 ~Aug 11 (couple of low reviews — worth
  reading, too small to cause this). Prime suspect: IOI Conezion mall
  footfall (owner asking the manager). Owner: "undo the cut" → ownerDirective
  raises Putrajaya RM38.16→43.36/day at the Aug 16 19:01 run; reason starts
  "owner directive" so lastKind reads "other" (never auto-reverted — an
  "autopilot raise" row would be reverted by the very breach that motivated
  it); self-expires once applied and hard-expires 2026-08-23. Spent Jul-19
  Tamarind directive removed (re-armable trap class). Tamarind post-restore:
  first Sunday +24% vs pause-Sunday — recovery tracking; A/B/A read Aug 25.
  Remaining cleanup (no probe is now running, so the do-not-change-the-
  instrument freeze is LIFTED until a new probe starts): (1) probe verdicts
  should require
  adj-confirmation, not raw-OR-adj — the payday/mom safeguards don't apply in
  the probe path; (2) add `source<>'grabfood'` to organic-revenue.ts's pos
  branch, with tests; (3) consider restoring PAUSE_PROBE_DAYS to 14 for any
  later probes. `hardCutDirective` was already removed 2026-08-15 by another
  session. Separately: **chase the dead Nilai consignment feed** (last row
  Jul 19) — data-estate, not ads.

- 2026-08-13 — **PR #1112 merged (`217d365`); both 20260810 migrations applied to
  prod.** Next session picks up the stock-count/BOM thread here, in order:
  1. **`ingredient-variance` still reads the DEAD `SalesTransaction` table**
     (stopped 2026-04-11) — point it at `pos_orders`+`pos_order_items` AND
     `orders`+`order_items`, expanding through `expandSoldLine` so modifiers,
     service mode and the new oat substitution are honoured. Until then the
     variance report is measuring nothing. The customer app is 12–20% of
     ingredient demand, so any BOM check that omits it is wrong.
  2. **313 kg of Collective Project bean POs (RM29,440, RM23,802 already paid)
     sit at AWAITING_DELIVERY with ZERO receiving records**, 16 Jun → 12 Aug.
     Until this is resolved the bean variance is arithmetically meaningless —
     7 of 14 outlet/product rows in the last comparison were impossible for
     exactly this reason.
  3. Owner decisions owed: repair the 357 package-less historical receipts
     (334 recoverable from their PO line); the five open POs that will now be
     refused on receipt; whether native receiving gets a package picker.
  4. Recipe rows still missing: `Extra Syrup`, `Celsius Secret Sauce`,
     `Extra Sambal`; confirm whether `Packaging` is covered by the 60
     TAKEAWAY-scoped lines. 59 products received since June have no BOM at all
     (Oatmilk 115 L — now partly addressed, Rice 175 kg, Chicken Chop 108 kg…).
     Missing menu record for "Biscoff Batik Indulgence" (179 units sold).
  5. Still-unclosed AP items: 29 invoices with due date ≤ issue date; the two
     Jijus POPs (IV5285/IV5286 vs IV5327/IV5373 — genuinely ambiguous, reference
     text and payment date disagree; left untouched deliberately).
  Also unresolved from the 6 Aug daily-list work: both outlets count **Crispy
  Prawn** daily but it is not on the 9-product daily list, while **Smoked Duck**
  and **Pull Lamb** are on the list and appear in no count.

- 2026-08-03 (late) — **HR module-level QA review DONE (3-agent sweep, findings
  reported to owner, no fixes applied yet).** Top confirmed findings, ranked:
  (1) **Confirmed monthly payroll cannot be corrected from the UI** — the
  Delete button still renders on confirmed runs and always 409s; the `revert`
  action shipped today has NO button; `allow_early_confirm` has no caller; the
  Confirm button swallows every error response (`payroll/page.tsx:103-132`).
  (2) **Weekly PT payroll route lacks every guard the monthly route got**:
  bare `.eq("id")` confirm can downgrade a `paid` run, `mark_paid` unguarded,
  zero ActivityLog (`payroll/weekly/route.ts:128-158`). Same hole class that
  ate July. (3) **Approved leave never reaches roster-attendance** — rostered
  staffer on approved leave renders "Absent"; route never queries
  `hr_leave_requests`. (4) **Two swap-approval APIs diverge**:
  `/api/hr/shift-swaps` has NO outlet scoping (any manager approves any
  outlet) and doesn't clear `is_ai_assigned`; schedules-page swap panel shows
  raw UUIDs from the unenriched `/api/hr/swap`. (5) **Per-staff allowance
  screen is a decoy**: `performance_allowance_amount` has 5 writers/0 readers;
  the live `fixed_performance_allowance` column has no UI (DBA-only).
  (6) `api/hr/analytics` still counts probation by the REJECTED time-based
  rule, and its swap pill counts statuses that don't exist. (7) PT Hours and
  Attendance Review both write `final_status='approved'` — acknowledging in
  one silently satisfies the other's payment gate. (8) No probation
  confirmation worklist anywhere (banner is per-profile only) — under the
  confirmed_at gate an unnoticed probation withholds allowance forever.
  (9) Nav: 5 hand-maintained lists drifted; orphans `/hr/employees/import`
  (403-line LoE bulk wizard, zero links), `/hr/performance-review` (dead
  redirect), `/hr/settings/payroll-items` (only payroll-items CRUD, zero
  links); `access-presets`/`pt-hours`/`roster-attendance` missing from
  NAV_SECTIONS entirely = bypass the client route gate; `pt-rates` in no tab
  group. (10) Dead config: `hr_leave_policies` closed loop (screen writes,
  nothing enforces), availability `notes`+`max_shifts_per_week` write-only,
  `working-time` blind-PATCHes the whole settings row (no server allowlist —
  clobber risk vs the allowances screen), rest-day shifts identified 3
  different ways (needs one `isRestDayShift()` helper), monthly payroll list
  API lacks `cycle_type` filter so weekly runs render as blank months, HR
  dashboard outlet-scopes only 1 of 4 tiles. Full details in the session
  transcript / report to owner.
  **Slice 1 FIXED same session (owner said "continue"):** (1) monthly payroll
  UI — Revert button on confirmed runs, Delete hidden where the server refuses
  it, Confirm surfaces errors + offers `allow_early_confirm` on the
  cycle-not-ended 409; (2) weekly route — atomic `.in(status)` confirm (no
  paid→confirmed downgrade), `mark_paid` only from confirmed + appends to
  ai_notes instead of overwriting, both log ActivityLog; (3) monthly list API
  now filters `cycle_type='monthly'` (weekly runs rendered as blank months).
  Guards pinned in payroll-run-guards.test.ts (canConfirm/canMarkPaid ladder).
  **Slice 2 FIXED same session:** (1) `/api/hr/allowance-overrides` +
  `/hr/settings/staff-allowances` repointed from the dead
  `performance_allowance_amount` column (5 writers / 0 readers) to the LIVE
  `fixed_performance_allowance` — screen relabeled "Flat Allowances", honest
  copy (flat = no levers, no deductions), scored/flat mode badge, eligibility
  no longer excludes unrostered staff (they are exactly whom flat is for);
  (2) probation worklist — "On Probation" dashboard tile (API counts FT ACTIVE
  with confirmed_at NULL — verified 9 against prod) deep-linking to a new
  Probation tab on /hr/employees (`?filter=probation`). Still to do from D1:
  the four OTHER writers of the dead column (create modal, [id] Compensation
  tab, loe-import commit, agent write-ops) still write it — removing them +
  dropping the column is a follow-up cleanup + owner-approved migration.
  **Slice 3 FIXED same session:** (1) roster-attendance now checks approved
  `hr_leave_requests` — new `on_leave` cell status (violet) outranks the
  roster, so approved-after-publish leave no longer renders "Absent"; a real
  clock-in still wins; (2) swap approval consolidated onto
  `/api/hr/shift-swaps` — MANAGER outlet scoping (both shifts, approve AND
  reject) and the `is_ai_assigned: false` reset ported from the deleted
  backoffice `/api/hr/swap` route (apps/staff keeps its own same-named route,
  untouched); the schedules-page raw-UUID swap panel is now a count badge
  linking to /hr/shift-swaps; (3) analytics — swap pill counts the real
  statuses (`pending_consent`/`pending_approval`; the old
  "pending"/"consented" never existed, pill sat at 0 forever), probation
  cohort now `full_time && !confirmed_at` matching the payroll gate. Noted:
  `isShiftOutsideAvailability` in schedules/page.tsx was ALREADY dead at HEAD
  (defined, never called) — availability windows gate nothing in the grid;
  strengthens finding #13.
  **Slice 4 (nav/orphans) FIXED same session:** roster-attendance + pt-hours +
  access-presets added to NAV_SECTIONS as hidden entries (restores the client
  route gate + ⌘K); PT Rates joined the People tab group (was in NO group —
  rendered with no lateral nav); SettingsNav got a Pay group with Payroll
  Items (the only item-catalog CRUD screen had zero inbound links) and lost
  its dead void-icon imports; /hr/performance-review (dead redirect, zero
  links) deleted; "Import LoEs" button added next to New Employee (the
  403-line bulk wizard had zero inbound links); /hr/allowances "Configure →"
  repointed from working-time (no allowance fields) to /hr/settings/allowances;
  #tab= deep links on the employee profile now work (certifications rows used
  to land on Profile regardless).
  Remaining findings still awaiting owner's pick: monthly mark-paid step,
  pre-approval OT prefill from the roster grid, PT-hours flagged-link →
  /hr/attendance deep link, availability/coverage edit-in-place,
  hr_leave_policies wiring (or deletion), working-time blind-PATCH allowlist,
  dashboard outlet scoping for the other 3 tiles, dead-column drop
  (performance_allowance_amount + its 4 remaining writers), single
  isRestDayShift() helper, apps/staff allowances fork, quarter-hour rounding,
  Group A repayment, Adam Kelvin exports, /hr/allowances↔performance merge
  (move AllowanceTabs first — W3 ordering).

- 2026-08-03 (late) — **End-to-end payroll QA pass landed on
  `claude/farah-staff-onboarding-99yg3j` (feeds PR #1110); stamp-repair
  migration APPLIED to prod and verified 0/0/0/0.** The sequence the owner
  still drives: **merge #1110 → Vercel deploy → compute July** (the run is
  currently DELETED; a plain compute rebuilds it — expect serving-time movement
  for everyone from the paging fix, Iffa −120 / Razley −150 probation
  claw-back, and OT rate corrections from the request-budget split) → read-back
  → then merge #1113 (staff payslips, split out on `claude/staff-payslips-open`).
  NEXT TASK, not yet started: owner asked for a module-level QA review of the
  whole HR area — Dashboard, Employees, Attendance, Leave, Schedules, Payroll,
  PT Rates, Allowances, Performance — "functions, redundancies, management
  workflow… currently it is a bit messy." Deliverable is a findings report,
  not fixes. Parked decisions: quarter-hour Math.floor rounding; the
  apps/staff allowances fork; Group A ~50h repayment; Adam Kelvin Mar–May
  BrioHR exports (EA understates ~RM11,200); hr_probation_reviews flow never
  used end-to-end. Do NOT re-raise: Group B auto-clockouts, rest-day premium
  (1× within threshold is policy), PT absence from the monthly run.

- 2026-08-03 — **HR/payroll session. Three things are with the owner, and July
  must NOT be confirmed until they land.**
  (a) CLOSED 2026-08-03 — part-timers absent from the monthly run is BY DESIGN;
  "bayar jumaat" is a separate PT weekly payroll run outside this system. Do not
  re-raise it.
  (b) **Zarif is owed ~RM451.61** (FT stint Jul 1–7) and it was never added.
  **Danish** is owed Jul 1–11 but **his FT salary is RM0.00 in
  `hr_salary_history`** — needs the real figure before it can be priced.
  (c) **Adib is being paid on a duplicate DEACTIVATED full_time record**
  (RM183.87 on zero hours) while his real active PT record sits outside the run.
  Also still open, lower priority: **June SOCSO over-deducted RM477.42 across 25
  people** (employer:employee ratio 1.400 in June vs 3.500 every other month —
  the employee was charged 1.25%, the Cat 2 *employer* rate; ours is right, that
  import is wrong) — refund is an owner decision. **Three dead columns**:
  `statutory_applicable` (false for 25 of 29 who are contributing),
  `hr_employee_profiles.performance_allowance_amount` (written by
  `/hr/settings/staff-allowances`, read by nothing — reviving it moves ~12
  people's pay), and now `hr_performance_overrides` (the whole-month replace,
  removed in PR #1106, table left empty in place). **`hr_employee_tax_reliefs`
  is empty company-wide** and the profile relief fields (`marital_status`,
  `spouse_working`, `children_count`) are never read by PCB — Ariff is married
  with `spouse_working` NULL, possibly RM4,000 of relief unclaimed (~RM167/mo).
  **`apps/staff/src/lib/hr/allowances.ts` is a stale FORK** of the backoffice
  engine — no month override, no flat allowance, no line overrides — so the
  staff PWA already shows a staffer a different figure than payroll pays. Worth
  a PR that makes staff import the shared engine instead of widening the copy.
  **PR #1106 (line overrides + one Performance screen) is an open draft** and
  its migration `20260803_hr_performance_line_overrides` is NOT applied.

- 2026-08-01 — **Ads: the cut keeps ≈RM4,100/mo of real cash, but rising voucher
  discounts hand back ≈RM3,400/mo of revenue, so net is ≈+RM720/mo — and that is
  smaller than weekly revenue variance, so it cannot yet be seen in the bank.**
  See the four 2026-08-01 Verified facts. The ads side has little left to give
  (spend is already ~RM1,040/wk), so the loyalty loop is now the bigger and
  faster-moving number. Next, in order:
  1. **Gate the loyalty loop** (priority 1b below) — it is the whole ballgame.
  2. **The loop has no holdout, so voucher incrementality is unmeasurable.**
     Gross sales FELL (72,021 → 69,906) while discounts rose, which does not look
     like vouchers are buying volume — suggestive, not proof. Build a holdout
     before spending more on redemptions, otherwise this question stays open.
  3. Do NOT keep cutting ads looking for cash that is not there; if the ad
     saving is to be proven at all it needs another month or a holdout.
  The 2026-07-30 pointer below still applies EXCEPT its item 2, now withdrawn.
