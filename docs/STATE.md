# STATE — cross-session memory

Working memory for agent sessions on this repo. Read this at the start of every
session; update it before ending one. Keep entries dated, terse, and factual —
delete entries that have been promoted into `CLAUDE.md`, a skill, or a doc.

## Verified facts

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
- 2026-08-03 — **Ariff's July PCB of RM618.50 is the understated figure and
  RM1,064.60 is the corrected one — July MUST be recomputed before it is
  confirmed or paid.** The deleted opening balance took his Jan–Jun YTD with it;
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

- 2026-07-29 — **Ads creative is now visible (PR #1088, merged 132034f8;
  migration `20260729_ads_campaign_creative` APPLIED to prod).** The ads sync
  covered spend and matched terms but nothing about the ad itself — no copy, no
  images, no landing-page URL, no geo radius, no ad schedule — so every
  creative question was unanswerable. `syncAdCreative` now snapshots five kinds
  into `ads_campaign_creative` (ad / setting / geo / schedule / asset), plus
  `hour_profile` (24-slot spend, prices the dead window). READ-ONLY by design.
  **Radius finding (evidence, pre-sync):** Putrajaya and Tamarind are only
  **~7 km apart**, and each campaign pays for the other's town — Tamarind spent
  RM24.47 on Putrajaya-named terms, PJ RM13.24 on Cyberjaya/Tamarind terms over
  14d (Shah Alam clean at RM0.53, it is 20km+ away). Radii overlap; we bid
  against ourselves. Direct visible bleed ~RM81/mo, but town-named searches are
  only the visible tip. **CPC is a diagnostic, NOT the objective** (owner
  challenged this): junk food-intent traffic is our MOST expensive at
  RM0.494/click vs café intent RM0.374 — a CPC-minimising rule would cut the
  valuable expensive clicks. Optimise for cash; use CPC as early warning only.

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

- 2026-07-27 — **Ads cut VERDICT: safe. Organic till FLAT on a payday-aligned
  read; guard rebuilt.** Owner flagged the methodology: Malaysian salaries land
  ~the 25th, so adjacent weeks sit at different points in a monthly demand
  cycle and are NOT comparable. Redone same-days-of-month (Jun 20–26 vs
  Jul 20–26 — payday-aligned AND weekday-complete, both post-cutover).
  **Use EVERY aligned window, not one** — the three available spread
  organic **−4.2% / −3.5% / 0.0%** (starts 18/19/20), mean ≈−2.6%, while TOTAL
  till is UP in all three (+1.5/+0.4/+3.1%, mean ≈+1.7%). An early pass quoted
  "organic FLAT +0.01%" from the single most favourable window — don't. In every
  window discounted revenue rose by MORE in ringgit than organic fell, so the
  organic dip is fully explainable by cannibalisation (walk-in switches to a
  voucher) rather than lost demand. Verdict: **47% ad cut, no visible harm, but
  the ~4pt window spread is as wide as the effect — unresolvable at this
  precision.** Cuts side **+RM4,252/mo** real; net bounded ≈−RM2k to +RM4.25k/mo.
  Per-outlet organic (20–26 window): PJ **+5.6%**, SA **−4.2%**, Tam **−1.5%**.
  Supersedes the Jul 26 "organic −6.8%, Tamarind −12%" reading, a pure
  payday-cycle artifact of comparing Jul 20–26 against Jul 13–19.
  **Guard rebuilt (PR after #1072):** (a) reads ORGANIC till
  (`ads/organic-revenue.ts`, promo/reward orders excluded; actual AND forecast
  history must come from the SAME series or the ratio compares organic against
  total and breaches instantly; labour-gate keeps TOTAL — a voucher order still
  takes labour; revert via `ADS_GUARD_REVENUE=total`); (b) `momIndex` = window ÷
  same days-of-month a month earlier, and a breach driven ONLY by rawIndex while
  momIndex ≥0.97 is flagged `calendarArtifact` and does NOT roll back
  (adjIndex/anchorIndex already cancel payday — one salary calendar fleet-wide —
  so only rawIndex was exposed); (c) scoreboard anchor clamped to
  `POS_CUTOVER_YMD=2026-06-18` so it cannot straddle the StoreHub→pos_native
  cutover (source of the phantom −RM13.5k/mo till Δ).
  **The organic/discounted split SUBTRACTS the SMS confound; it does NOT
  attribute revenue to gads** (organic = walk-ins + regulars + Grab + ads; an
  ad-driven customer redeeming an SMS voucher counts as discounted). Real
  channel separation still needs a holdout or the value-based conversion tag.

- 2026-07-25 — **"Old app version suddenly reappears" = expo-updates OTA
  regression from `runtimeVersion.policy: "appVersion"`** (branch
  `claude/version-regression-bug-adwked`, draft PR). Owner screenshots showed
  the pickup app's Orders tab flipping between the pre-tabs empty state and the
  newer "In progress / Past orders" tabs — same `apps/pickup-native/app/
  orders.tsx`, different JS BUNDLE. Root cause: `appVersion` policy glues the
  OTA runtimeVersion to the marketing `version`, so every bump (pickup-native
  climbed 1.0.0→1.0.3, buildNumber 12 / versionCode 10) mints a NEW runtime and
  **severs the OTA update lineage** — post-bump OTAs only reach the new runtime,
  and a device landing on a fresh store binary boots its embedded (older) bundle
  with no matching OTA to pull it forward (reinstall = fresh store build =
  recovers). Fix: **pickup-native only** → `policy: "fingerprint"` (owner
  narrowed scope from all-three to just pickup; pos-native + staff-native LEFT on
  `appVersion` — same footgun still latent, migrate on their next store build).
  Fingerprint changes iff the native layer changes, so marketing-version bumps no
  longer sever OTA. **Transition cost:** the fix lands on the next native build;
  the fingerprint switch also means the normal `pickup-native-ota.yml` now
  publishes against a fingerprint runtime no installed app matches. Added
  `pickup-native-ota-catchup.yml` (manual dispatch, default runtime `1.0.3`) to
  republish current JS against the in-field appVersion runtime so the live fleet
  catches up on next launch. **Catch-up was EXECUTED successfully 2026-07-25**
  (owner said "do for me") — `eas update` published to the `production` channel,
  **runtime 1.0.3, android+ios**, update group `2ad415b6-9974-41a1-abae-
  23477603fe17`; the 1.0.3 fleet pulls the current bundle on next launch.
  Mechanism notes (learned the hard way): the integration can't use
  workflow_dispatch (403), so the workflow fires on a `.ota-catchup-trigger`
  marker push (mirrors pickup-native-ota-deploy.yml); eas-cli has **no
  `--runtime-version` flag** — pin runtime by writing a literal
  `expo.runtimeVersion` into app.json at publish time (ephemeral). Still on
  `appVersion`: pos-native, staff-native. The eager
  fetch+reload hook in `_layout.tsx:160` was NOT the bug. Also noted (not
  touched): `pickup-native-ota-deploy.yml` publishes CURRENT-branch JS to the
  prod channel on a marker bump from an arbitrary claude/* branch — a separate
  footgun worth removing later.

- 2026-07-23 — **Ads autopilot: root-consolidation regression found + fixed;
  the "till held" claim corrected.** (a) **Regression:** the Jul 21
  consolidation REMOVED the working literal negatives "restaurants" /
  "restaurants near me" in favour of the root "restaurant". Google's negative
  themes do NOT stem plurals — both resumed spending the next day (SQL-verified
  natural experiment: spend →0 while literals were applied Jul 18–21, →back
  Jul 22–23; RM24.46 in 2 days across Tam+PJ ≈ RM370/mo). Slots ended back at
  25/25 on all three campaigns, so the swap bought nothing. Food/restaurant
  intent is now RM105/7d fleet-wide (Tamarind **19.7% of its whole spend**, PJ
  10.7%, SA 5.2%). Fixed: consolidation is **additive only** (never removes a
  literal), new `verify-exclusions.ts` runs a nightly leak check
  (`findLeaks` → re-exclude the literal, `planSlotSwap` value-ranked eviction,
  `scoreNegatives` measures a negative by the junk it actually covers —
  needed because consolidation roots carry no `estMonthlySavingMyr` and would
  otherwise rank as worthless and be evicted). `superseded` ledger rows are now
  retryable. (b) **Correction:** the Jul 21 "till held flat, RM4,056/mo banked"
  was overconfident. Decomposing by discount status (clean post-cutover,
  cut-week vs prior 4w): organic till RM8,628→**8,495/day (−1.5%)**, discounted
  (SMS-voucher) RM1,459→**1,690/day (+16%)** — the flat top-line is two
  opposite moves, and **the guard reads TOTAL till so it cannot see ad damage
  while SMS ramps**. Honest cash range **+RM1.8k–4.25k/mo**, not RM4.25k.
  Budgets held at PJ 51.51 / SA 53.98 / Tam 52.97 (fleet RM158.46/day, −47%)
  since Jul 22, in the 14d observation window. **Next:** point guard +
  scoreboard at ORGANIC till before observation expires ~Aug 3; then either
  hold budgets through ~Aug 5 for a clean organic read or freeze one outlet as
  an ad-control. Also owed: remove inert `hardCutDirective`, fix scoreboard
  StoreHub-cutover anchor.

- 2026-07-23 — **SMS loop is live and sending** (corrects an earlier
  mis-read): `sms_logs` is STALE (last row Jun 21) — the real sends go via SMS
  Niaga and are tracked in `loop_rounds`; the provider dashboard shows 200–500
  SMS/day all through July. `winback` is on round 36, status 'sent' daily by
  `cron:loops-trigger`. **Problems:** `approved_at` is NULL on all 75 July
  rounds (cron self-approves, design called for an approve gate); arms have
  drifted to **cash discounts** (RM10 off RM30+, 15%/20% off) against the
  margin-safe-only policy; segments are 25–60 people with ~3-person holdouts so
  `campaign_outcomes` verdicts are almost all 'invalid' (130 rows, backfilled
  in one batch Jul 18). 6,869 campaign vouchers issued Jun 22–Jul 23, 184
  redeemed (2.7%). No trustworthy incremental-cash number exists for SMS yet.

- 2026-07-22 — **First-order 10% discount made native-app-only** (branch
  `claude/first-order-discount-check-lx938r`, draft PR). Business intent: the
  welcome 10% is now a native-app perk (drives installs) on BOTH pickup and
  dine-in; the web/PWA gets nothing. FOD config still lives on the
  `promotions` row `promo-first-order-celsius` (trigger_type=first_order,
  percentage_off 10, is_active). Data finding that drove this: over 30d, FOD
  landed on 0/2,511 dine-in orders (any source) but ~30% of pickup — because
  the row was `channels=['pickup']` and dine-in runs the `qr_table` channel;
  the split was order-type, NOT native-vs-PWA. **New mechanism:** gate on
  order `source`, not channel. `/api/orders` (native, source app_ios/
  app_android — pickup + dine-in) applies FOD; `/api/checkout/initiate`
  (PWA, QR-table dine-in, source web_qr) and `/api/checkout/quote` (PWA
  preview) no longer apply/preview it. The `promotions.channels` field is now
  vestigial for FOD (code gates on source); left at `['pickup']`. Native
  checkout still only shows FOD at the receipt (its preview uses
  `/api/loyalty/promotions/evaluate`, which excludes first_order) — unchanged,
  possible follow-up. **Live-behaviour note:** the discount only lands at
  order create, so it needs the PR deployed; until then prod behaviour is
  unchanged (native pickup only).

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

- 2026-07-16 — **Finance warehouse baseline (SQL-verified against kqdc).**
  Fresh: unified_sales pos_native →7/16, consignment →7/12 (Nilai settles
  later than older notes claim — re-verify live, don't trust dated notes);
  BankStatement 3 accounts →7/15; BankStatementLine 56,429 rows, 0
  uncategorised (rule 55,119 / ap-match 1,134 / user 169 / manual 7); GL
  4,621 posted txns / 10,446 lines / COA 116 active; June payroll actuals
  booked RM77,259.50; unpaid AP 72 PENDING RM45,060 + 16 INITIATED RM7,780
  + 9 DEPOSIT_PAID RM20,988. **Findings:** `fin_agent_decisions` has only
  7 rows, ALL agent='purchasing-manager' — the finance agents' documented
  decision-log/eval dataset is NOT accumulating (logDecision not on live
  paths or failing silently); ALL 19 fin_periods 2025-01→2026-07 are open
  (no close ever approved); 88 draft fin_transactions linger (latest 6/30);
  37 future-dated posted rows are month-end depreciation (legit convention,
  but descriptions contaminated with bank narrations); July MTD lens gap:
  till RM133,241.75 vs GL income RM163,976.74. Full inventory + backlog:
  `docs/design/finance-data-warehouse-agent.md`.

- 2026-07-12 — **Data-consolidation audit for the internal assistant (all
  SQL-verified against kqdc).** Connectivity clean: 0 orphans across
  unified_sales/roster/checklist/invoice/bank-line joins. unified_sales VIEW is
  the ONLY sales truth (merges pos_native live + storehub ≤6/17 + hubbo ≤1/20 +
  consignment; cutover verified per-outlet exclusive, no double-count).
  Dead/empty tables (never query): SalesTransaction (ends 4/11),
  fin_bank_transactions, fin_invoices, fin_bills. TWO revenue lenses: till-rung
  (unified_sales nett, Jun ~RM284k) vs banked GL income (Card+Cash/QR+Grabfood+
  GastroHub, Jun ~RM406k, settlement-lagged, SST-incl) — Grab delivery revenue
  exists ONLY in the GL/bank lens. NILAI = consignment outlet (no till; sales
  are periodic consignment settlements, latest 6/28; 0 ParLevel rows; its
  "ownerless checklist" alerts are likely SOP misconfig for that model).
  "orders" (lowercase, customer pickup) ≠ "Order" (procurement PO). All other
  domains fresh as of audit day (attendance, stock counts, reviews, loyalty,
  bank feed via Bukku 6h sync — 3 accounts = complete set per owner). Encoded
  in `apps/backoffice/src/lib/ops-intake/data-map.ts` (the assistant's
  intelligence layer) — keep that file updated when semantics change.

- 2026-07-12 — **April-era "Celsius QA" Telegram monitor decommissioned (cron
  side).** It was two systems, both built ~Apr 5–7 against the pre-monorepo app
  layout (standalone inventory/loyalty apps, retired since):
  1. `qa-health-check` edge function on the **celsius-inventory** Supabase
     project (`akkwdrllvcpnkzgmclkk`) + pg_cron jobs `qa-health-check`
     (`7 * * * *`, hourly — matched the 1:07pm alerts) and `qa-health-report`
     (4×/day). This was the source of the "🚨 Celsius QA Alert" Telegram spam
     about `inventory.`/`loyalty.celsiuscoffee.com` DNS failures. **Both cron
     jobs unscheduled 2026-07-12** (cron.job on that project is now empty). The
     function itself is still deployed, publicly invocable (`verify_jwt:false`),
     and has a **hardcoded Telegram bot token in its source** — rotate the bot
     token and delete the function from the dashboard (MCP has no delete).
  2. `qa-health` + `qa-autofix` edge functions on the **main** project
     (`kqdcdhpnyuwrxqhbuyfl`), pg_cron `qa-health-check` every 30 min, check
     list in the `qa_health_checks` table. Its 4 inventory/loyalty rows had
     been failing since April (4,200 consecutive failures; `qa_alerts` grew to
     ~10k rows since Apr 7) and each failure re-triggered `qa-autofix` — which
     can **redeploy retired Vercel projects** (loyalty/inventory/pos project
     IDs are hardcoded in it).

  **Fully cleared 2026-07-12 on owner's go-ahead:** the main project's 30-min
  cron unscheduled; `qa_alerts`/`qa_fix_rules`/`qa_health_checks` dropped
  (migration 080 — note: they were in `prevent_drop_critical_tables()`'s
  hardcoded protected list, which the migration amends to remove ONLY those
  three); all 3 edge functions (`qa-health`, `qa-autofix`, `qa-health-check`)
  overwritten with secret-free 410 tombstones + `verify_jwt` on (MCP cannot
  delete functions — delete from the dashboard at leisure). Nothing monitors
  the live apps now — BetterUptime (ops-hardening checklist §3) is the
  intended replacement. **Human actions remaining:** rotate the Telegram QA
  bot token (old versions of `qa-health-check` embed it in source), delete
  the 3 tombstoned functions, and decide whether the idle `celsius-inventory`
  Supabase project (`akkwdrllvcpnkzgmclkk`) can be paused/deleted entirely.
- 2026-07-10 — **Vercel schedules at most 40 cron jobs per project; entries past
  40 are silently never scheduled.** vercel.json hit 46 (Jun 30) and the tail —
  procurement-exec, par-levels-recalc, request-invoices/receivings,
  consumption-post, labour-variance — was dead ~10 days with zero errors.
  Consolidated to 37 via dispatchers (`cron/procurement-loop`, `cron/ops-nudges`);
  `apps/backoffice/src/vercel-crons.test.ts` fails CI past 38. **Never append a
  41st cron — fold into a dispatcher.**
- 2026-07-10 — Procurement loop has a watchdog (`lib/inventory/loop-watchdog.ts`,
  runs in the procurement-loop cron): stale pars, undelivered cold prompts,
  100%-failing send channels, stale proposals/drafts → owner WhatsApp digest,
  fingerprint-deduped. Agent lessons (agent-lessons.ts) default ON since #895.
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

- 2026-07-04 — Procurement loop: automated PO-send to suppliers over WhatsApp
  (`purchase_order` / `po_approval` buttons) was designed but **never shipped**;
  sending the order block is still manual. Agent only needs an open PO to exist.
  (Source: `docs/design/procurement-e2e-test-runbook.md`.)
- 2026-07-04 — Stock accuracy is shadow-only (consumption engine off); reorder
  runs off receipts − wastage/transfers, not sales. Going live needs unit
  normalisation + recipe import (`docs/design/procurement-qa-2026-06-26.md`).
- 2026-07-05 — RLS coverage is broader than `docs/rls-strategy.md` claims
  (three later migration sets added deny-all/policied RLS to HR, bank, ads,
  and all `fin_*` tables) — but the **loyalty tables' policies are
  `USING (true)` for all roles, so member PII/points are anon-readable AND
  writable**. Full verified map + ranked fixes:
  `docs/rls-access-map-2026-07-05.md`.
- 2026-07-04 — 14 Vercel crons fail silently into logs (no heartbeat
  monitoring wired yet). `reconcile-pending` (order, every 1 min) is the
  payments-critical one. See `docs/monitoring-setup.md`.
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
- 2026-07-05 — All six 2026 monthly payroll runs are status `draft` (no
  OT/allowances finalised) — FT actuals read ~RM3k/outlet flattering vs the
  workbook until closed.
- 2026-07-05 — 4 scheduled staff have no `hr_employee_profiles` row
  (Hidayat, Irfan, a 2nd Haziq — Putrajaya; Fatin — Tamarind). The labour
  gate blocks publishes that include them until profiles+rates exist.
- 2026-07-05 — Shift templates of record are the `hr_shift_templates` DB
  rows (Opening / Middle 1–3 / Closing per outlet); `lib/hr/shift-templates.ts`
  is only the fallback when the table is empty.
- 2026-07-14 — **Multi-outlet staff rotation (code-verified).** Membership is
  `User.outletId` (primary) + `User.outletIds[]` (additional) — editable ONLY
  in Settings → Staff (outlet checkboxes; the HR employee page edits primary
  only). Every scheduling surface pools `outletId OR outletIds has`: grid,
  AI Fill, assist candidates. Assist candidates (`schedules/candidates`)
  count weekly hours ACROSS outlets (query is user-scoped, not
  outlet-scoped) and flag `double_booked`/`over_cap` cross-outlet; they also
  score a `home` signal (primary 1 / outletIds 0.8 / other 0.5). Clock-in
  (`staff /api/hr/clock`) picks the nearest assigned outlet by GPS, so
  attendance logs the outlet actually visited. Leadership rotation = the
  rover path (Manager/Area Manager/Barista Lead, 2 days/outlet, HQ-costed,
  cross-outlet busy check). **Gap:** AI Fill's cross-outlet busy check
  covers rovers ONLY — a regular FT/PT in two outlet pools is generated
  independently at each (FT: 6 days at BOTH; PT: 24h/5d caps applied per
  outlet run → up to 48h), and the manual `cell`/`assign` writes have no
  hard cross-outlet overlap guard (the warning is advisory in the ranking
  UI only). Fix shape: extend the rover `busy` set to all pooled staff in
  the generator, seed `ptWeek` from other-outlet shifts, add an overlap 409
  in cell/assign.
- 2026-07-14 — **Multi-outlet double-booking fixed** (branch
  `claude/staff-rotation-outlets-kmobpa`, PR #934). Owner rule chosen:
  **primary outlet wins**. AI Fill (`schedule-generator.ts`) now: (1) loads
  every pooled staffer's shifts at OTHER outlets for the week
  (`bookedElsewhere`) and never places anyone on a day they're already
  working elsewhere; (2) floors a full-timer's 6-day week ONLY at their
  primary outlet (`isPrimaryHere = User.outletId === outletId`) — a shared FT
  is listed in `ai_notes` as "rostered at their primary, not here" and must be
  borrowed manually at secondary outlets; (3) seeds each PT's `ptWeek`
  hours/days from other-outlet shifts so the 24h/5-day caps bind on the
  COMBINED total. Manual writes: `cell` + `assign` routes call
  `findCrossOutletOverlap` (new `lib/hr/cross-outlet.ts`) and 409 on a
  same-day cross-outlet time overlap. **Residual (best-effort, documented):**
  generation is per-outlet on-demand, so "primary wins" for a same-day PT
  conflict relies on generating home outlets first — no destructive
  cross-outlet steal. The assist-candidate ranking was already
  cross-outlet-aware (user-scoped hours, `double_booked`/`over_cap`).

- 2026-07-18 — **Sales Compare robustness pass (branch
  `claude/sales-compare-robustness-q5peil`).** Four verified gaps in the
  backoffice unified-sales path (`api/sales/_lib/unified-sales.ts`), all
  fixed there so every consumer (compare, dashboard, P&L-sourced, recon)
  inherits: (1) 741 StoreHub rows with `status='paymentCancelled'` but
  `is_cancelled=false` (RM24,398.90, Aug 2025–Jun 2026) were counted as
  revenue — the raw path lacked the canonical convention's status filter;
  (2) `hubbo_sales` (70,395 rows, the pre-StoreHub till for
  Putrajaya/Shah Alam through Jan 2026) was missing entirely — any
  comparison reaching before the outlet's StoreHub start read near-zero;
  raw path now mirrors the view's exclusive handover split (hubbo <
  handover instant ≤ storehub); (3) consignment-only outlets (Nilai, IOI
  Mall — `storehubId` NULL) were excluded by compare's outlet filter, so
  "All Outlets" silently omitted them; (4) `computeProjection` still read
  DEAD SalesTransaction → server projection was always null (client 7d-MA
  fallback masked it); re-pointed to the unified_sales view with the
  canonical revenue convention. Also: sales-channel dimension
  (till/qr_table/pickup_app/grabfood/beep/delivery_other/consignment,
  `_lib/source-channels.ts`) now flows through compare (`sources` per
  period + UI breakdown table), consignment daily rows carry
  units=item_count into orders/AOV, and partial-vs-full comparisons show
  an aligned "first K days" pace line in the summary cards. MERGED as
  #976. Round 2 (owner: "cannot pick multiple outlets"): outlet filter is
  now multi-select — API takes `outletIds=a,b,c` (legacy `outletId` kept
  for the staff bridge), UI is a checkbox popover; selecting every outlet
  collapses to the all-outlets default. MERGED as #992. Round 3 (owner:
  "check all the ux ui, improve it"), page-only pass: presets are visible
  chips (active highlighted); page auto-opens on This Month vs Last Month;
  state persists in the URL (?p=&o=&m= — shareable links); refetches dim
  the old results instead of blanking (full spinner only on first load);
  fixed a REAL Tailwind bug (template-string `sm:grid-cols-${n}` is never
  JIT-generated — summary cards always fell back to 2 cols; now a static
  class map); Rounds table gains an "Other hours (11pm-8am)" row so Total
  reconciles with its rows; Order Type table flipped to rows=type ×
  cols=periods (consistent with all other tables) + share %; Month tab in
  the Add Period picker (last 12 months); chart gains a dashed "now"
  reference line + whole-K y-ticks ≥100k; summary deltas labelled
  "vs {period}"; outlet-context caption beside the metric toggle. Round 3b
  (owner screenshots): **REAL BUG — outlet-filtered compare showed stale
  cross-outlet data.** Cent-exact forensics: "Tamarind" card = Tam+SA,
  "Shah Alam" card = ALL outlets — overlapping fetches with no guard; an
  older bigger response landing last overwrote the newer one. Fixed with a
  fetch sequence guard + AbortController. Also: "Other Delivery" (owner:
  "should be grab") is actually the retired StoreHub Beep channel (May-era
  volume ≈ Grab's; Grab has its own row) — relabelled "Beep / Other
  Delivery". NEW: Payment Method dimension in compare (per-period gateway
  table, Δ + share of tendered total + coverage row; pos dominant-tender +
  pickup payment_method; validated cent-exact vs the By Payment report for
  Jul 11-13; StoreHub era has no payment splits — caveat shown).
  Round 3c (owner: "add QR Table to By Channel tab"): Sales Reports → By
  Channel rebuilt from order-type (dine-in/takeaway/grab) to the SALES
  CHANNEL source axis (Till/QR Table/Pickup App/GrabFood/Beep/Consignment,
  each order once) — QR Table was previously invisible, folded into
  dine-in/takeaway. reports.ts buildByChannel now aggregates ev.source via
  SOURCE_ORDER/SOURCE_LABELS; note points to Sales over time for the
  dine-in/takeaway split (which keeps its order-type columns). Verified
  Jul 11-13 all-outlets: Till 21,208.52 / QR 8,049.80 / Grab 3,314.20 /
  Pickup 602.30 = 33,174.82, cent-exact vs By Payment total. Frontend is
  fully generic (columns/rows/note) — no page change needed.

- Typecheck before pushing — every time. CI enforces it, but catch it locally.
- Never test against the production database; the procurement runbook's seed SQL
  is staging-only.
- When a fix is confirmed working, record *why it worked* here or in the relevant
  skill — not just in the chat.

## Open failures

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

## Resume pointer

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

- 2026-07-31 — **PR #1094 (stock-count freshness + expiry) is a DRAFT awaiting
  CI.** Two commits: `920a80b` (18h stale → no auto-approve; CI green) and
  `1237124` (24h expiry + soft block + countDate re-stamp). No migration, so it
  is mergeable without owner sign-off on prod DB — but it changes what the staff
  app does at the till, so confirm before merging. Open questions for the owner:
  (1) was the 29 Jul Putrajaya stock physically counted that day or spread to
  the 31st? — decides whether that count can be reconciled at all;
  (2) whether to add per-line `countedAt` on `StockCountItem` (needs a
  migration) so a long count can be sliced by the day each line was keyed,
  instead of judged as one blob.
  Still unanswered from earlier in the session: the 12 INITIATED payments where
  the owner says POPs were shared — bank feed shows NO matching debits through
  26 Jul and there are 0 `tg:` transcript rows, so either the payments were
  never made or the POPs were lost to the known Telegram-persistence gap. That
  gap (and MULTI_POP under-extraction) is still unfixed.
- 2026-07-29 — **Two threads open, both HR.**
  (a) **Clock-out geofence fix is deployed but unverified** — see the Verified
  facts entry above. Needs a *deliberate* test at the IOI Mall kiosk; passively
  watching Farhan will not produce one (he ends every shift at Conezion).
  Also open: whether to widen the new 250m IOI zone (a real clock-in landed at
  279m), and the unflagged ~5km clock-ins.
  (b) **Availability lock requested by Farah (manager, WhatsApp)** — he wants
  staff blocked from changing availability Fri→Mon so next week's roster inputs
  can't move under him after he builds it. Nothing like it exists in the repo
  (no lock/freeze concept anywhere in HR). Scoping established: the weekly
  pattern is RECURRING so it blocks outright; one-off blockouts must be blocked
  only for dates inside the protected week; `pt-loop/inbound.ts:379` (WhatsApp)
  is a third write path that rewrites the pattern wholesale and would otherwise
  bypass the lock. `apps/staff` and `apps/staff-native` share one endpoint, so
  one server-side check covers both. Weeks are Monday-anchored
  (`hr_schedules.week_start`), so the protected week derives from the calendar —
  no week picker needed. HR tables are SQL-managed (no `model hr_*` in
  schema.prisma), so this ships as standalone SQL, no migration-guard exposure.
  **Blocked on two owner decisions:** manual switch vs automatic Fri→Mon, and
  own-outlet-subtree vs fleet-wide.
- 2026-07-29 — **Mystery reward could silently miss its moment on QR-table
  orders (fixed).** Owner asked whether QR-table still has mystery rewards:
  YES — not gated on order type, 56/59 paid QR orders from signed-in members
  got a drop in 7 days (95%), pool active (56% no-bonus / 27% +100 pts / ~17%
  voucher). But `_MysteryReward.tsx` did a ONE-SHOT lookup on mount with no
  retry, while `markRmOrderPaid` commits the paid status BEFORE running
  `applyOrderV2Hooks` (which mints the drop) — and the card mounts the instant
  the tracking page's 5s status poll first sees "paid". So the lookup raced the
  insert; when it lost, the card stayed empty for that whole page view and the
  customer only found the reward by reopening the order. Reward was never lost,
  only the moment. **Fix: bounded retry** (2.5s × 16 ≈ 40s, stops as soon as a
  drop is found or is already revealed) — client-only. Deliberately did NOT
  reorder the payment path: the status-first update with
  `.in("status",["pending","failed"])` is the idempotency guard that makes the
  hooks run exactly once. NOTE: guests get no drop at all (minting is inside
  `if (order.loyalty_id)`) — by design, but walk-ups never see it. QR-table
  reveal rate was 48%.
- 2026-07-28 (later) — **OT policy: FT-only + backlog cleared.** Owner: "remove
  backlog OT from before jul" + "OT is only for FT". Root cause of the backlog:
  the OT sync cron (`api/hr/overtime-requests/sync`) auto-created a pending
  request for EVERY attendance log with ≥1h computed OT, including part-timers
  — but PT never gets an OT premium anywhere (monthly run is FT-only; weekly
  run pays flat hourly on total_hours, `total_ot_hours` always 0; an approved
  PT OT request only lifted the daily roster cap at flat rate). Data (prod SQL,
  owner-directed): cancelled 81 pre-Jul pending requests (Apr, 138h, note
  "Pre-Jul 2026 backlog cleared") + 116 PT July pending requests (285h, note
  "OT is FT-only"); 24 FT July requests (48h) left pending for manager review.
  No pay impact — none were ever approved. July monthly run reads only
  clock_in within Jul, so pre-Jul attendance OT (Mar 3.65h + Apr 177.66h)
  never entered it; those attendance rows left intact as history. Code (this
  branch): sync cron filters to full_time; OT-request POST 400s for non-FT
  ("adjust the roster"); weekly-calc cap note no longer tells managers to
  approve PT OT. Dedupe note: sync's existing-keys check includes cancelled
  rows, so cancelled days won't be re-created even before deploy. Still open:
  Yusri Bin Safarudin (DEACTIVATED but on Jul run at full RM2,100 — awaiting
  owner's last-working-day answer).
  Follow-up (same day): owner added "if early clock in, the counter should
  starts during their shift starts" → `deriveHours` (identical copies in
  apps/staff + apps/backoffice `lib/hr/hours.ts` — keep in sync) gained
  optional `scheduledStart`; pay-hours (and hence the OT threshold) count
  from max(clock_in, rostered start), total_hours still records the real
  span. All 4 callers pass the roster stamp (staff clock-out, AI processor,
  auto-close cron, manager set_times). Pinned in hours.test.ts. MERGED as
  #1083 (squash edbe065). Owner then approved recompute of the 9 early-
  clock-in FT July OT rows: applied 2026-07-28 (prod SQL) — total FT July
  OT 18h→5h (Sherry Jul5 5→2, Atthirah Jul8 3→2, Shairuleen Jul25 2→1,
  six rows→0); matching pending OT requests synced (6 cancelled, 3
  corrected), leaving 18 pending FT requests in the queue. ⚠ Two rows
  look like BAD ROSTER STAMPS, not early birds — Shairuleen Jul 16 (worked
  07:09–16:51 MYT but rostered 15:30 → now pays only 1.36h) and Hidayat
  Jul 18 (worked 08:05–20:06, rostered 12:00 → pays 7.11h) — manager
  should verify the real shift and fix via set_times/roster if wrong.

- 2026-07-28 — **HR Ops Agent stage 2 BUILT: guarded writes** (this branch;
  design §6b). Typed op allowlist (create/update/convert/reactivate/resign/
  assignment/set_pin/salary_change) + stage→CONFIRM-code flow
  (`hr_agent_pending_actions`, migration `20260728_hr_agent_pending` — **not
  yet applied to prod**): managers' changes confirm with HOO, salary/bank with
  OWNER, codes single-use/15-min/phone-bound, deterministic pre-LLM confirm
  hook in the webhook. Staff persona gains submit_leave_request (lands
  pending for manager) + update_my_contact; write tools absent outside
  mode='armed'. Owner explicitly chose to arm ahead of the 5-clean-shadow
  criterion — per-write human confirm is the compensating control. Earlier
  same-day: staff-native leave form date-fix OTA'd (#1076, run 30289741291
  success), 31 leave-balance rows seeded (15 FT staff), owner phone rebound
  +60109335369 (was on the App Store Review dummy). **Next:** merge+deploy,
  apply pending migration, flip registry to 'armed', live-test one staged
  write end-to-end.

- 2026-07-27 (cleanup) — **`apps/pickup` + the dead KDS shell DELETED (branch
  `claude/pwa-pickup-removal-9qysgv`, follow-up to #1073/#1075).** Owner:
  "delete apps/pickup and the dead kds shell." Removed: `apps/pickup` (legacy
  Capacitor webview wrapper `com.celsiuscoffee.pickup`; STORE_LISTING.md moved
  to `docs/store-listing.md`), `apps/order/android` + `capacitor.config.ts`
  (the vestigial "Celsius Orders" KDS webview pointing at retired /staff/kds),
  `.github/workflows/build-kds-apk.yml`, the 3 `@capacitor/*` deps in
  apps/order, the `apps/pickup` workspace entry + `typecheck:apps` leg, and
  the pickup legs of the CI typecheck/build matrices. KEPT: middleware
  `capacitor://localhost`/`ionic://localhost` ALLOWED_ORIGINS — field installs
  of the old webview app still exist on customer phones and load the site
  live; drop only when the old store listing is confirmed dead. Verified:
  order typecheck clean, full vitest 511/511 (note: `npm i --ignore-scripts`
  skips `prisma generate` — 7 suites fail with ".prisma/client" missing until
  `npx prisma generate --schema packages/db/prisma/schema.prisma`). Camera
  scanner on /scan shipped as #1075 (jsQR in-browser, same /table handoff;
  owner kept native manual entry). Remaining owner decision: rename Vercel
  project `celsius-pickup-app`.

- 2026-07-27 (later) — **App-identity audit + Expo web bundle REMOVED from the
  web (branch `claude/pwa-pickup-removal-9qysgv`, PR #1073).** Owner: "there
  will be no pickup app in PWA" + "clean up which code is which app." Verified
  map: `apps/order` = THE customer webapp (order.celsiuscoffee.com, Vercel
  project misleadingly named `celsius-pickup-app`) — QR-table ordering +
  loyalty; `apps/pickup-native` = THE customer native app "Celsius Coffee"
  (`com.celsiuscoffee.pickup.next`, App Store id6766792077) — NOT a KDS
  despite CLAUDE.md's old label; `apps/pickup` = LEGACY webview wrapper
  (`com.celsiuscoffee.pickup`, no `.next`) that loads order.celsiuscoffee.com
  LIVE (old installs mirror the website in real time); `apps/order/android`
  + `build-kds-apk.yml` = vestigial "Celsius Orders" KDS webview pointing at
  the retired `/staff/kds` (page no longer exists). **Shipped on the branch:**
  (1) `/scan` added to isNextOwned (stopgap, then subsumed); (2) pickup-native
  manual-table-entry removal REVERTED (owner: native untouched — net-zero
  native diff, no OTA); (3) **PR A**: middleware SPA-rewrite + isNextOwned +
  PWA_PASSTHROUGH deleted (all routes Next-owned, unknown → 404),
  `build-pwa.mjs` deleted, build = `next build` only, sw.js v45→v46 (purges
  cached Expo shell; push handlers kept), new `<RegisterSw />` in layout
  (registration used to live in the Expo shell's inline script). Safe:
  native payment returns use `celsiuscoffee://`, never web /rm-return.
  (4) **PR B**: CLAUDE.md layout table + hard rule 5 + ota-release skill
  corrected (pickup-native = customer phones) + skill Lesson appended.
  **Web-push subscribe PORTED same session** (`lib/web-push-client.ts`;
  Settings toggle now actually subscribes + POSTs /api/push/subscribe — the
  old toggle only flipped browser permission; RegisterSw silently refreshes
  already-granted browsers on boot, no prompt). **Follow-ups needing
  owner:** delete `apps/pickup` (is the
  old `com.celsiuscoffee.pickup` listing retired?); delete `apps/order/
  android` + `build-kds-apk.yml` (what do kitchen screens actually run?);
  optionally rename Vercel project `celsius-pickup-app`.

- 2026-07-27 — **PWA pickup removal follow-up: the customer SPA IS the Expo
  pickup app, and `/scan` was leaking into it.** After #1028 merged, live
  verification (via `mcp__Vercel__web_fetch_vercel_url`, since
  `order.celsiuscoffee.com` is NOT in the CCR egress allowlist — proxy 403,
  same class as the sentry.io block) exposed the real architecture: **`apps/order`
  is a HYBRID** — `apps/order/src/middleware.ts` serves an allowlist of
  `isNextOwned` routes (`/ /menu /cart /checkout /store /table/* …`) from the
  Next.js pages, and **rewrites every other route to `/index.html`, which is the
  Expo react-native-web build from `apps/pickup-native` copied into
  `apps/order/public/` by `scripts/build-pwa.mjs` at build.** So the customer
  "PWA" shell literally IS the pickup-native app; un-ported routes render it.
  **Bug in #1028:** `/scan` (my new Next page) was NOT added to `isNextOwned`,
  so on prod middleware rewrote `/scan` → Expo pickup SPA shell — the
  OutletGate/cart/checkout redirects were dumping customers INTO the pickup PWA
  (opposite of the wall). Live-confirmed: `/store` → Next.js 307→/scan (my
  redirect works), but `/scan` → served Expo shell (`/_expo/static/…`, desc
  "Order your favourite Celsius Coffee drinks ahead and skip the queue").
  **Fix (this follow-up branch, restarted from merged main):** added
  `pathname === "/scan"` to the `isNextOwned` allowlist. Typecheck clean.
  **STILL OPEN (systemic, needs owner decision):** the Expo pickup SPA is the
  fallback shell for all non-allowlisted routes; fully retiring pickup means
  either rebuilding `apps/pickup-native`'s web target without the pickup flow,
  or replacing the `/index.html` SPA-rewrite fallback with a redirect to /scan.
  Manifest `start_url` is "/" (Next home = scan instruction). Installed PWAs
  with a cached Expo bundle + `sw.js` (network-first, cache `celsius-v45`) are a
  secondary stale-access vector.

- 2026-07-26 — **HR Ops Agent: designed + stage 1 BUILT** (this branch;
  design `docs/design/hr-ops-agent.md`, audit `docs/hr-data-audit-2026-07-26.md`).
  WhatsApp agent on the business number, personas by sender. Authority matrix
  owner-approved (subtree rule; two-person rule for money: new-hire salary =
  HOO alone, salary *changes* = owner confirms, bank changes never from a
  staff message alone). Stage 1 code: staff-persona assistant
  (`lib/hr/agent/staff-assistant.ts` — own-record reads shifts/hours/leave/
  claims, LOE policy answers, escalate-to-HQ; NO pay figures, NO writes), HR
  ops tools in the internal assistant (`lib/hr/agent/ops-tools.ts` —
  find_staff w/ manager PII-gate+subtree, hr_data_gaps, propose_hr_change
  shadow proposals → ledger + owner digest), webhook staff branch (staff
  messages ALWAYS consumed before supplier flows — fixes staff-MC-read-as-
  invoice; runs AFTER pt-loop's protocol replies), registry seed
  `20260726_hr_ops_agent_seed` (mode 'off', **not yet applied to prod**).
  Verified: tsc, eslint, vitest, next build. **Next:** apply seed + flip
  shadow (owner), stage 2 armed writes after 5 clean shadow diffs, PIN-gated
  pay reads, doc intake (blocked: session egress denies supabase.co storage
  host). Design evidence = the 2026-07-16→20 manual onboarding arc (5 staff
  ops). Open: persona name ("Cel"), BM register samples, chaser cron.

- 2026-07-23 (evening) — **Cashflow "upcoming cash" view: Grab reconciled into
  the incoming forecast, daily run-rate strip added, marketing follows the live
  ad budget (all MERGED: #1051, #1053).** Same-day continuation, driven by the
  owner using the cashflow page as their main upcoming-cash view.
  1. **Grab folded into the Incoming settlements forecast (#1051).** The panel's
     "Expected" read ~RM8k/day vs the ~RM10.6k/day the owner knows from the bank.
     Decomposed trailing bank credits: the panel forecast card/online/QR/
     GastroHub but **excluded Grab** (~RM614/day). Grab was left out as
     "unverified cadence" — but the bank shows it settles **daily and near-flat**
     (a payout every day of the week). Now projected from its trailing 28-day
     **bank run-rate** (already net of commission), placed flat across the
     window, attributed to HQ account 4384. `settlement-forecast.ts` gained a
     `grab` channel + a `reconcile` field; `IncomingPanel` shows Grab + a
     footnote citing the residual ~RM56/day of non-sales credits (meetings/
     refunds/misc) still not forecast. Grab bank categories: `GRAB`,
     `GRAB_PUTRAJAYA`.
  2. **Daily cash run-rate strip (#1053).** New `loadDailyRunRate()` +
     `/api/finance/cashflow/daily-averages` + `DailyRunRateStrip.tsx` above the
     settlement panels: avg cash **in/out/net per calendar day** from actual
     bank flows (external only, `isInterCo=false`), 90-day trailing, split
     weekday/weekend. Live numbers: **in RM10,692/day, out RM10,861, net
     −RM168** overall; **weekday net −RM793** (big supplier/payroll/rent
     outflows clear on weekdays) vs **weekend net +RM1,370** (low sales, almost
     no outflows). This is the home for the "≈RM10.6k/day" figure — the
     settlement panel is a narrower, forward, net-of-fee view and legitimately
     reads lower. Respects the page account scope.
  3. **Marketing follows the LIVE Google Ads budget (#1053).** The marketing
     pulse sized Google Ads off the trailing bank run-rate (~RM8.8k/mo), but the
     ads **optimizer agent loop** now controls spend and had trimmed the
     allocated budget to ~RM4.8k/mo — a cut the 90-day bank average wouldn't
     reflect for ~90 days. New **`getLiveAdsDailyBudgetMyr()`** in
     `lib/ads/optimizer.ts` (sum of ENABLED non-manager campaigns'
     `dailyBudgetMicros`; `ENABLED_STATUSES = ["2","ENABLED"]` — status is the
     Google Ads numeric enum stored as a string). `computeCashflow` marketing =
     live ad budget + SMS Niaga + KOL (latter two stay on the bank run-rate,
     not agent-controlled); falls back to the bank Google-Ads run-rate if the
     ads module is empty. `bankLineProjection` marketing split into
     `adsBankPerDay` (fallback) + `otherMarketingPerDay`. Monthly marketing
     pulse dropped ~RM9,474 → ~RM5,490/mo and now self-adjusts with the loop.
  - NOTE for next session: DIGITAL_ADS is deduped out of the bank P&L (it's
    tracked in the ads module) — the cashflow live-budget read is the forward
    view of that same spend. Grab attribution in the incoming panel lands all
    Grab in HQ 4384 (where it pools), which slightly inflates that entity's
    byEntity line — acceptable (it's "where cash lands"), flag if it confuses.

- 2026-07-23 — **Cashflow model deepened: recurring schedule corrected,
  inter-company classifier fixed, outflows re-modelled (all MERGED: #1037,
  #1042→#1045).** Continuation of the 13-week-model session below. Owner
  reviewed the model line-by-line and drove several corrections:
  1. **RecurringExpense schedule fixed in prod** (direct SQL, no migration —
     these are forecast rows, `RecurringExpense` has no audit triggers):
     salary → **3rd** (Putrajaya + HQ, RM73,875); rent → **8th** (Putrajaya,
     Tamarind, HQ, **+ Shah Alam RM5,700 which was entirely missing**);
     statutory → **15th**; loan → **1st** (NEW `OTHER` row RM4,415 = WME000001
     2,233 + WME000002 2,182, the two external financing SIs from SA). Dates
     are stored as midnight-MYT (= `day-1 T16:00Z`); the app reads UTC +8h, so
     to fire on day N store `(N-1)T16:00:00Z`.
  2. **Inter-transfer double-count removed.** EPF/SOCSO is remitted CENTRALLY
     from SA (~RM15,552/mo); outlets fund it by transferring their share into
     SA first. The auto-generator had turned Tamarind's funding transfer into a
     2nd "Statutory — Tamarind" RM5,084 line → **deactivated** (isActive=false).
     Keep statutory as ONE central line unless remittance stops being central.
  3. **#1042 inter-company classifier fix (MERGED #1045).** DR legs of
     inter-co transfers were mis-flagged `isInterCo=false` since ~June 2026:
     `INTERCO_COUNTERPARTY` only matched the old `"TRANSFER TO/FR A/C CELSIUS
     COFFEE <ENTITY>"` format; Maybank changed to `"CELSIUS COFFEE <ENTITY>.*"`.
     Fix is **account-aware** (`bank-line-classifier.ts`): a Celsius payee is
     inter-co only when its entity ≠ the account the line sits on — the WME
     loan debits on SA's own account correctly stay external. `accountKey` is
     passed at every live call site. **Backfilled 11 legs (RM58,621.98) in
     prod** via the same account-aware SQL; 4 SA loan legs left external.
     STILL OPEN: the mis-classification is in the underlying bank feed too
     (inter-co DR legs tagged false) — only the classifier + these 11 rows
     fixed; a broader reclassification sweep may be warranted.
  4. **Outflow re-model (MERGED #1045).** Broke the "other outflow" smear
     apart in `cashflow.ts`: **PT wages → weekly Friday pulse** sized from the
     LATEST PUBLISHED ROSTER (each outlet's most-recent week summed via
     labour-gate `ptCost`; bank PARTIMER rate is fallback; new `ptOut` field +
     "PT wages (Fri)" row). **Marketing → monthly pulse on the 20th** from the
     bank run-rate (DIGITAL_ADS+OTHER_MARKETING+KOL) — the old `ads_invoice`
     feed was EMPTY so marketing showed RM0 while ~RM2k/wk left the bank;
     removed dead `projectMarketing()`. **COGS double-count fixed**: run-rate
     reduced by the committed-invoice-per-day rate (floored 0) so supplier
     invoices + COGS don't stack. **Discounts**: settlement is already net of
     discount — added an informational "Discounts given" stat to IncomingPanel
     from `unified_sales.discount` (~3.2% of gross). Grab commission is NOT an
     outflow line (Grab settles net). 493 tests green.
  - **Cash-in numbers reconciled for the owner** (recurring confusion): three
    different figures — external CR gross ≈ RM10.7k/day (isInterCo=false, all
    sources incl. Grab/StoreHub-tail/capital); monthly table "Cash in" INCLUDES
    interco by default (toggle Interco off to exclude); Incoming panel ≈ RM7.8k
    net sales settlements this week (ex-Grab, net of fee). The Cashflow page's
    "Avg cash in" KPI already responds to Period(custom range)+Scope(interco
    on/off)+Grain. Possible follow-up the owner half-agreed to: a "sales-only"
    cut of Avg cash-in (strip capital/refunds/StoreHub tail).
  - **Later same day — chased down "we never had a negative closing balance"
    (MERGED: #1046, #1047, #1049, #1050).** Model showed an early-August trough
    of **−RM54,811**; reality never went negative (real min ≈ RM623). Root
    causes, fixed in layers:
    5. **COGS double-count was smeared, not netted per-week (#1047).** COGS was
       `bankCogsPerDay * activeDays − invoiceOut` with the invoice offset spread
       evenly, so weeks with a big supplier invoice still carried near-full COGS
       on top. Now netted **per bucket**: `cogsOut = max(0, salesIn*foodCostPct
       − invoiceOut)`. **Payroll fired a week early (#1047):** MYT midnights are
       stored `(N-1)T16:00Z`; `expandRecurring` walked the raw UTC value, so a
       3rd-of-month pulse could land in the prior week's bucket. Fixed by
       `cursor = nextDueDate + 8h` before the bucket walk. Invoice remaining now
       uses shared `remainingAmount()`.
    6. **Salary + rent amounts were overstated ~RM15k/mo (corrected in prod,
       direct SQL).** The recurring rows carried gross/accrual figures, not the
       actual external bank outflow. Corrected to **actual bank outflow**:
       salary total **RM64,021** (HQ 51,899.50 + Putrajaya 12,121.50), rent
       total **RM31,795**. Owner chose "set to actual bank outflow, fix amounts
       first."
    7. **Salary consolidated to ONE HQ-managed line (prod SQL).** Verified all
       outlets are paid centrally from the SA account (4384) and that "Salary —
       HQ" already included Putrajaya. Replaced the per-outlet salary rows with
       a single **"Salary (central, incl. all outlets)"** = RM64,021 (HQ,
       `outletId` NULL, fires the 3rd); "Salary — Celsius Coffee Putrajaya"
       deactivated. Verified statutory (15th) is NOT bundled into the 3rd
       payroll pulse — they are separate recurring rows.
    8. **Daily balance walk (MERGED #1049).** Replaced the linear-interp
       `buildProjectedDaily()` with a real day-by-day walk: builds an `exactOut`
       map (invoices on due date, recurring via `expandRecurring`, salary/
       marketing on their dates, PT on Fridays) and walks each bucket's 7 days
       placing `dowAvg[dow]+otherInPerDay` in and `cogsPerActiveDay+
       otherOutPerDay+exactOut` out → `dailyBalance.projected` +
       `projectedDailyMin` (page shows "Lowest day" alongside "Lowest
       week-end"). Surfaces intra-week troughs the weekly close hides.
    9. **COGS now follows the BOM, not the 46% supplier-payment rate (MERGED
       #1050).** Owner: "cogs 34k is too much, we should follow bom" → chose
       "Live BOM % (36.5%, auto)". New `bomFoodCostPct()` sales-weights
       `menu_margins.recipe_cost` over 60d of completed `pos_order_items` +
       `order_items` (matched on lower(trim(name))), clamped 15–60%, fallback
       `BOM_FOOD_COST_FALLBACK = 0.365`. `menu_margins`/`product_costs` DO now
       exist with real recipe costs (supersedes the 2026-07-18 cogs-activation
       note that said BOM costing wasn't built). **Combined effect of 5–9: the
       early-August trough went from −RM54,811 to ≈ +RM4,500 (positive),
       matching the owner's reality.** OPEN: the ~10-pt gap between bank COGS
       (46% of settlements) and BOM (36.5%) is real waste/shrinkage/delivery-fee
       leakage — worth a variance loop (BOM-implied vs actual supplier spend).
- 2026-07-22 — **POP matcher: separator-tolerant invoice-reference matching
  (PR #1024).** Owner asked why a RM148 Blancoz payment was in the Confirm-POP
  queue when the receipt named its invoice. Root cause: the receipt quoted
  `26 0677` (space, off the bank app) for our `26-0677` (hyphen); step-1's
  exact-equality match and step-8's raw-`contains` guard both missed on the
  separator, so it fell to the blind picker against unrelated same-amount
  siblings (26-0713/0714/0746). Fix: `normalizeInvoiceRef` folds both sides to
  an alphanumeric key before comparing — step 1 gains a normalised fallback
  over the open-invoice pool (supplier-scoped, exact normalised equality so
  `260677`≠`1260677`); step 8's named-invoice lookup prefilters on the longest
  digit run then compares folded keys. Also cleaned the stuck record: attached
  ref `936475062M` to the already-PAID 26-0677 + RESOLVED the stale PendingPop
  (d306da79) → the three phantom badges cleared. Owner insight worth acting on:
  finance IS quoting invoice numbers on transfers — the more consistently that
  ref lands in the payment detail, the fewer POPs reach the picker at all.

- 2026-07-22 — **Cashflow page adopts the 13-week model + outgoing payables
  panel (branch `claude/cashflow-13week-payables-kozj9o`, draft PR #1037).**
  Owner: "best is to do the 13 weeks cashflow model… incoming settlement is
  very good, need to add incoming payables… easy to filter incl. custom date."
  Shipped: (1) forward horizon defaults to 13w (4/8/13/26) and the weekly
  projection table is TRANSPOSED into the classic treasury layout (line items
  as rows, weeks as columns, Receipts/Disbursements/Net/Closing, lowest week
  tinted) — same computeCashflow engine, no math change; (2) NEW
  `lib/finance/payables-forecast.ts` + `/api/finance/cashflow/payables` +
  `PayablesPanel` mirroring IncomingPanel: unpaid invoices on due dates
  (remaining honours amountPaid/deposit, same rules as the weekly
  projection), active RecurringExpense occurrences on theirs, standing
  Overdue block relative to TODAY (past-due + undated invoices — can't hide
  behind the date filter), day rows expand to payee lists, category chips;
  (3) incoming + payables APIs/panels both take custom from/to (shared
  DateRangePicker) alongside 7/14/28d presets, capped 92 days. Unit tests for
  the pure payables fns; 491 tests green. NOTE: recurring occurrences use
  month-add date walking (same day-31 drift as cashflow.ts addMonths —
  consistent, not fixed). Next: owner feedback on the transposed grid, and
  whether payables should also feed a per-outlet filter.

- 2026-07-21 (procurement round) — **PR #990 merged (`c268332`) + staff-native
  OTA published (run 54, green 03:07 UTC).** Ships: GRNI placeholder namespace
  (`GRNI-<outletCode>-<n>`), supplier-scoped POP number matching + placeholder
  corroboration, capture NUMBER_FORMAT_MISMATCH guard, and the
  balance-receiving fix (staff web + staff-native prefill the REMAINING qty on
  partially-received POs — was double-counting stock on the second receiving).
  Managers get the receiving fix on next app launch. **Awaiting owner sign-off
  (payment records):** TMM CC001 RM509.76 re-number pending TMM SOA + detach
  MnM photo; void/merge MnM "1-15150" duplicate of IVCT-00012005; untangle the
  1-15441 duplicate rows (Nilai INITIATED vs CC003); resolve RM894 NYC picker
  (stale ref "1216") and RM924 verifier proposal → INV-2682. **Waiting on bank
  feed:** the 5 Jul-20 unmatched payments (Dankoff IN600161377 909.15, TMM
  1-15441 679.68, 365IN2607-0019/0020 490 each, XORA SO-31844 590) — re-match
  when debits land; 3 INITIATED with no debit yet (YSIV2606-1644 932.20,
  F26071056 181, INV-2026-0717-001 120) — owner to check bank app. NYC 1220
  RM606 overdue, unpaid. **Known bugs, unfixed:** Telegram POP conversations
  not persisted (0 `tg:` rows in WhatsAppMessage — no audit trail) and the
  MULTI_POP splitter can silently under-extract pages from a batch PDF (root
  cause of the 5 stuck INITIATED from Jul 20) — good next PR.

- 2026-07-21 — **PWA pickup removal FINISHED (branch
  `claude/pwa-pickup-removal-9qysgv`).** Owner screenshot showed a live
  "PICKUP FROM Celsius Coffee Putrajaya" checkout in `apps/order` despite an
  earlier "pickup removed" belief. Root cause: the removal had only cut the
  two ENDS — the home entry (`_OutletRow` → "scan your table") and the SERVER
  guard (`api/checkout/initiate` rejects non-dine_in with "use the Celsius
  app"). The whole MIDDLE of the pickup funnel was still live: `/store` outlet
  picker + `_StoreList`, `menu/_OutletGate` REDIRECTING no-outlet visitors to
  `/store?next=menu`, `_OutletPickerRow` `/store` link, and `/cart` +
  `/checkout` rendering the full "Pickup from {outlet}" branch with an enabled
  Place-order button — so a direct visitor (bookmark, marketing URL, Google)
  built a complete pickup order and only dead-ended at the final tap. Owner
  chose **scan-your-table wall** for the no-table case. Shipped: new `/scan`
  wall (`_ScanWall.tsx`; bounces a still-fresh dine-in context back to /menu,
  else "scan the QR on your table" + Get-the-app CTA via `/get-app`).
  `getDineInContext()` (checkout-session.ts, fresh<6h) is now the authoritative
  "valid session" gate: `_OutletGate` redirects to /scan without it;
  `/cart` + `/checkout` guard-redirect to /scan without it and always send
  `orderType:"dine_in"`; pickup wording gone ("Pickup from" → "Table N ·
  outlet"; outlet-closed banner "Switch/pick another outlet" → "order at the
  counter", /store link dropped). `/store` is now a `redirect("/scan")` stub,
  `_StoreList.tsx` DELETED, `_OutletPickerRow` non-dine-in branch returns null.
  Server guard left intact (defense-in-depth). Native pickup app
  (apps/pickup-native → `/api/orders`) UNTOUCHED — it's the intended pickup
  channel. Typecheck + lint clean (order app). NOTE: `npm ci` fails on `sharp`
  postinstall (libvips download 403 through the proxy) — use
  `npm ci --ignore-scripts` for typecheck in this env.

- 2026-07-20 (round 16) — **Slot-sizing saga: open slots now follow the FULL
  scheduling logic (PRs #1016 + #1017, both merged; #1015 merged + OTA'd
  earlier).** Owner pushed three times and was right each time. (1) "why 5-6
  slots/day?" → the poster was publishing the optimizer's candidate MENU
  (one gap per template touching a short hour — same 13:00 hole appeared in
  4 overlapping templates); #1016 posts the smallest template set clearing
  the residual per-hour shortfall. (2) "we already have 495 hours, you
  schedule wrong" → hour-level audit proved it half-true: Tue had 3 bar
  openers vs 2 closers with the third body needed in the evening — the
  generator posted a slot for a hole its own FT split created. #1017 adds an
  FT OPEN/CLOSE REBALANCE pass (donors keep need+2-head anchors, Fridays
  skipped for prayer steering, no clopenings) BEFORE any slot is considered.
  The kitchen slots were structural: 5 kit-capable FT × 6d = 30 shifts,
  anchors alone eat 28, demand wants ~34 — a bench gap, not placement.
  (3) "12 slots will shoot up the people cost" → slots are now FUNDED from
  the same RM envelope as the old PT fill (forecast × target% − FT cost),
  ranked kitchen→anchors→deepest days, priced day-aware (9/10/2×PH,
  cheapest eligible PT); unfunded gaps become ⚠ UNMANNED notes + an ai_note
  naming the cost of covering them. Final slot pipeline: demand → FT base →
  rebalance → residual gaps → day cap (ptTargetByDate) → envelope funding.
  PJ 2026-07-27 is a revenue-constrained week (FT floor 20.7% > 18% target,
  envelope RM0) → regeneration posts ZERO slots there by design; owner's
  levers: lend FT, accept higher %, or manual Post slot (stays uncapped as
  the deliberate override). Also this round: employment-window guards
  everywhere (join_date/end_date — generator onLeave rail, grid rows, cell
  route, Assist pool, request+assign; live cases Afique last day 07-31
  mid-week, Auni starts 07-27), open-slots panel collapses to a one-line
  summary ("cannot see schedule" fix), Why-staffing popover edge-alignment
  fix (#1013). Serve-rate calibration flag for owner: model says Sat 9am
  needs 5 cooks (25 items/h ÷ 5.1) — if reality disagrees, recalibrate the
  kitchen serve target, not the slot logic.

- 2026-07-19 (round 15) — **Open slots become REQUEST → ASSIGN, and AI Fill
  goes open-slots-first (owner: "can ai fill open the slots first before we
  assign anyone?" → "lets do they request, we assign" → "after filled,
  manager publish").** The loop is now: AI Fill posts every PT demand gap as
  a bookable slot (new default `ptMode: "open_slots"`; "PT: suggest" option
  in the Fill dropdown restores named pt_suggestion proposals) → PTs REQUEST
  slots in the staff apps (hand-raise, several can; withdraw supported;
  "N asked" count shown) → manager ASSIGNS one requester from the schedules
  grid panel (requester rows show name + week h/d load; assign re-validates
  station/caps/one-outlet-per-day server-side, materializes the shift on the
  DRAFT week, declines the rest) → labour-gated Publish as usual. NEW TABLE
  `hr_open_shift_requests` (migration 091, applied to prod, additive; unique
  open_shift_id+user_id, statuses pending/assigned/declined/withdrawn).
  Staff API POST now creates a request (no more instant claim from apps —
  WhatsApp TAKE keeps instant claim for urgent decline/no-show backfill).
  Unmanned-station QA now splits "⏳ open slot posted, pending booking" from
  the hard "⚠ UNMANNED". Round-14 QA also verified live: 4 manual slots
  posted at PJ by the team via the new UI; claim/assign semantics dry-run
  against prod in a rolled-back txn; NOTE none of PJ's 3 PTs could take
  those barista slots (Nurfarah 23h near-cap, Farhan Ikhmal 29h/6d OVER
  caps in the published roster, Badri kitchen-only) — flagged to owner.
  Weekly-availability table still empty (owner screenshot showed unsaved
  editor) — confirm one real "Save pattern" post-deploy.

- 2026-07-19 (round 14) — **Availability UX overhaul + backoffice open-slot
  management (PR #1011, merged; round-13 base was PR #1010, merged — both
  OTA'd to staff phones and live on Vercel).** Owner: "improve the ux on my
  availability... easier to type numbers, font bigger" and "open slots in
  backoffice logic is not managed yet." Availability screens (web+native):
  typing eliminated — preset window chips (Morning 07:30–15:30 / Midday
  12:00–20:00 / Evening 15:30–23:30) + 30-min pickers (chip strip native,
  dropdowns web, end-times auto-restricted), one-tap Any day/Weekdays/
  Weekends, ≥44px targets, fonts ~2 sizes up, live plain-words summary.
  Backoffice: new /api/hr/open-shifts (GET week's slots + claimant names /
  cancel-if-still-open / create manual slot source 'manual'; hr:schedules
  gated, manager outlet-scoped) + schedules-grid panel (open slots
  cancellable ✕, booked green with names, "+ Open slot" day×template×station
  form). REMAINING E2E LEG (owner action): a PT saves a pattern → regenerate
  a draft week (Jul 27 untouched) → ai_notes show "N PT with declared
  availability" + "N OPEN SLOT(S) posted" → PT books from phone → shift on
  grid. Fastest smoke test: post one manual slot from the grid and have a PT
  book it. Availability table still empty — nothing changes until PTs
  declare; owner should blast PTs to fill it (expect: Aiman weekends-only,
  Batrisyia evenings; ask SA manager about Danish's 2-day week).

- 2026-07-19 (round 13) — **Staff availability input + open-slot booking =
  the self-service PT fill loop (this branch).** Owner: "1. create an
  availability input in staff apps (native/webapp) 2. create a fill / book
  slot in staff apps 3. verify the flow to fill pt." Discovery first: the
  substrate mostly existed — `hr_open_shifts` (migration 084) with a proven
  WhatsApp claim flow (pt-loop inbound `handleClaim`, first-accept-wins),
  `hr_staff_weekly_availability` (EMPTY — nobody could input it) and
  `hr_staff_availability` (staff web page existed but was gated OWNER/ADMIN).
  Shipped: (1) **generator now respects declared availability** — weekly
  windows (whitelist semantics, same as Assist candidates: rows exist → only
  those days/windows; no rows → flexible), per-date unavailable/off blocks,
  and `max_shifts_per_week` tightening the 5-day cap; applied in BOTH greedy
  filter and the validator (catches LLM proposals). (2) **Generator posts
  unfilled gaps to `hr_open_shifts`** (source `generator`, idempotent per
  outlet+week: still-open generator slots replaced on regen, claimed ones
  untouched) + ai_note "N OPEN SLOT(S) posted". (3) **Staff web**: weekly
  pattern editor on /hr/availability (gate opened to all staff) + new
  /hr/open-shifts page; APIs /api/hr/availability/weekly (replace-wholesale)
  and /api/hr/open-shifts (GET eligibility-annotated list; POST claim =
  ported WhatsApp semantics PLUS 24h/5-day cross-outlet caps + one-outlet-
  per-day, materializes the real shift row). (4) **staff-native**: My
  Availability + Open Slots screens, lib/hr/api.ts fetchers, HR hub tiles
  (NOTE: staff-native merge = OTA deploy — ota-release skill applies).
  **Live-schema catch:** `hr_staff_weekly_availability.available_from/until
  are NOT NULL in prod** (code comments claimed nullable) — "any time" is
  stored as explicit 00:00–23:59; fixed the latent WhatsApp bug where a
  null-window reply violated the constraint UNCHECKED after the delete,
  silently wiping the PT's declared availability. Insert shapes verified
  against prod inside a rolled-back transaction. E2E after deploy: PT sets
  pattern → regenerate a draft week → open slots appear in staff apps →
  book → shift lands on grid; payroll cap already counts claimed slots
  (notes=template_id, not pt_suggestion).

- 2026-07-19 (round 12) — **Published-roster audit vs the AI logic (owner:
  "my staff already done and publish next week schedule... use our
  scheduling logic against what they arrange", then "i found few
  inconsistencies... can you find more?").** Confirmed owner's four (PJ Tue
  7 FOH shifts = +11h over target with mornings still at 2 FOH; PJ Thu +4h;
  PJ Sun FOH −10h on the busiest bar day + kitchen +9h same day; Tamarind
  NO morning cook Tue–Fri and no evening cook Sun). Found more: SA kitchen
  unmanned evening Tue / mornings Wed+Fri; Danish (FT kitchen) scheduled 2
  days with NO leave record (root cause of SA holes; Zikry's 5-day week IS
  leave-backed); PT cap breaches Emran 31h net, Naufal/Fatin/Qaisara 30h;
  SA Mon/Sat/Sun whole-day 2-FOH; Tam Sun morning 1 FOH; 12 clopenings;
  PJ kitchen over target all 7 days while FOH under on 5. Friday prayer OK
  at PJ only. Then reverse-audited for staff logic the AI misses → 4 real
  gaps: rover circuit allocation (Syafiq 1 outlet/day), fixed shift
  identities (Haziq always opener, Aina 12–20), PT truths not in DB
  (weekly-availability table was empty — round 13 builds the input), and
  manager-as-cover placement (Adam parked on the thinnest days; open
  question: should a PUBLISHED manager shift count as coverage?). Audit
  data + engine in scratchpad (published-week-v2.json).

- 2026-07-19 (round 11) — **Weekly PT payment flow: manager sign-off →
  gated per-person payment file.** Owner: "proceed with the payment
  file. also the managers also needs to confirm each PT hours first
  before paying." No migration needed — hr_attendance_logs already had
  final_status/reviewed_by; "confirmed" = final_status approved/
  adjusted. Shipped: (1) **HR → PT Hours page** (manager-scoped, tab in
  the Attendance group): per-PT weekly clock logs with day-aware
  rate/pay preview (weekday/weekend/PH 2×), one-click "Confirm all
  clean" (pending+unflagged), per-log confirm, flagged logs route to
  the existing Attendance review queue; API GET/POST
  /api/hr/payroll/weekly/pt-hours (bulk confirm never overwrites
  adjusted/rejected, manager outlet-gated). (2) **bank-file endpoint
  reworked** (kept URL): run must be finance-CONFIRMED, every closed
  non-rejected log in the week must be manager-confirmed (409 names
  who), missing bank details now BLOCK (the old version silently
  dropped payees), per-person reference "PTW<ddmm> <name>" for
  statement-line reconciliation (kills the outlet lump-sum blindspot
  the finance warehouse flagged); pure builder lib/hr/payment-file.ts
  (+3 tests). Weekly payroll page: fetch-based download with a
  blocker banner (was window.open dumping raw 409 JSON). Flow: manager
  confirms (PT Hours) → finance Compute → Confirm → Payment file →
  bank portal approval → Mark paid.

- 2026-07-18 (round 10) — **PT weekday/weekend rates (owner: "diff
  weekdays weekends... follow and fix the data" + the "Celsius - Part
  Timer 2025/26" Google Sheet).** Sheet forensics (6,047 ledger rows):
  history 2024–early-25 was a clean RM8 wd / RM9 we; current entries
  inconsistent (mostly flat 9, three PTs flat 10, PH entries 18/20 =
  2×). Adopted the one rule that resolves every inconsistency:
  **RM9 weekday / RM10 weekend / 2× public holiday** — stated to owner
  for veto. Shipped: migration 090 APPLIED (hr_employee_profiles.
  hourly_rate_weekend, NULL→base fallback); `lib/hr/pt-rate.ts`
  (ptRateForDate — single pricing fn); day-aware pricing wired into
  weekly PT payroll calculator (per-clock-log rate + PH set from
  hr_public_holidays, rate recorded per shift in computation_details),
  labour-gate costRoster + ptCost, AI Fill PT suggestion costing
  (holidays from weekForecast.byDate), employee page Compensation
  section (weekend field, OWNER/ADMIN-gated, added to PII list).
  Backfilled prod: 28 PT/intern profiles → 9/10 (was 26×9, 1×8, 1×10).
  Earlier same day (rounds 8–9 follow-ups, all merged): #981 week-aware
  Jumaat (Friday rests to prayer-goers, Thursday closing keeps women
  clopening-eligible), #982 cap-cascade + breadth-first PT fill +
  canonical outlet order (Putrajaya→SA→Tamarind→Nilai→IOI via
  lib/outlet-order.ts at 8 endpoints) + Assist tab removed, #985
  kitchen-gaps-first + ⚠ UNMANNED station warnings (Tamarind weekend
  kitchen catch). Open owner decision: Tamarind kitchen supply 12 vs 14
  anchor slots — raise PT cap / cross-train / accept flagged gaps.
- 2026-07-18 — **GRNI namespacing + capture format guard (follow-up PR).** New
  placeholders mint as `GRNI-<outletCode>-<n>` via
  `lib/inventory/placeholder-number.ts` (6 mint sites switched; legacy `INV-#`
  rows still recognised). POP matcher: number lookups now scope to the supplier
  identified by the transfer's bank account, and placeholder-shaped refs
  require amount/payee corroboration (they stay matchable — finance pays off
  the card showing them). Capture: `numberShapeMatchesHistory` flags an
  extracted number whose shape doesn't match the supplier's history
  (NUMBER_FORMAT_MISMATCH flag) — would have caught the TMM/MnM contamination.
  **Photo forensics (both "stolen number" rows read):** TMM CC001 RM509.76 row
  (`ec3496d5…`) carries MnM's IVCT-00012381 photo AND number — its real TMM
  number is unknown (likely paid by the unresolved 7/16 POP ref 9376518471);
  MnM "1-15150" row (`bed3d671…`) is a DUPLICATE of IVCT-00012005 (same photo,
  RM432 6/26) on a second PO — one real Jul-10 payment recorded on two rows.
  Both corrections need owner sign-off (rename-to-true-number turned out
  impossible; proposal = re-number TMM row pending SOA + resolve its POP, and
  void/merge the MnM duplicate pair).

- 2026-07-18 — **POP matcher: found the never-armed QA loop, armed it (PR #986
  branch).** Owner asked "is the matching agent improving itself?" — answer was
  NO: the pop-verifier (LLM judge at matcher dead-ends, pop-verifier-run.ts) had
  0 verdicts ever (env gate never set; registry `procurement_pop_verifier` mode
  off), pop-lessons was behind a second never-set env, and the third dead-end
  (ambiguous → Telegram picker) had no coverage at all — 6/6 PendingPops
  untapped/rotting. Fixed: verifier mode now read from agent_registry
  (shadow=propose+flag, armed=code-gated auto-pay; env =false stays as kill),
  registry flipped off→shadow in prod, every verdict logged to agent_actions
  (measurable improvement), pop-lessons default ON + learns from resolved
  PendingPops (finance's picker choices), loop-watchdog check #6 pings owner on
  PendingPops unresolved >24h. Same PR: number-match narrowing by
  amount/payee/outlet (the "multiple matching invoices" root fix). Still open:
  6 unresolved PendingPops need human picks; TMM/MnM cross-stamped invoice
  numbers (IVCT-00012381 on a TMM row, 1-15150 on an MnM row) need photo-read
  corrections; Tier-1 phantom reverts (~RM2,370) await owner sign-off.

- 2026-07-18 (round 9) — **Friday-prayer staffing rule (Jumaat).** Owner:
  "put opening female on friday to run friday prayer. including non
  muslim. currently only gulaf is non-muslim." `gender` and `religion`
  columns ALREADY existed on hr_employee_profiles (religion is staff-app
  self-service, HR read-only; gender HR-editable M/F) — no migration.
  Backfilled prod: 61 profiles religion='islam', Guraf Lal Joshi
  'other' (exact faith unknown; he can self-correct). Generator:
  `attendsFridayPrayer(gender, religion)` (unknown gender/religion =
  attends — safe default), Friday fillStation sorts prayer-free staff
  into prayer-spanning openings and prayer-goers into closing; ai_note
  per Friday either confirms the rule held or names who's exposed
  (~13:00–14:15) and needs relief. Assist: `friday_prayer` flag + amber
  chip + ~10-point fit penalty on Friday slots spanning 13:00–14:00.
  Gender data now COMPLETE for all rostered staff (owner supplied: PJ 5
  male; SA/Tam/Nilai 10 female + Emran male; only Anwar IOI + HQ Anis/
  Hanis blank). Round-2 owner catch on the regenerated week: rule ran
  but had nobody to prefer — the rest placer had RESTED Aliana on
  Friday (gender-blind WHO) and Iffa CLOSED Thursday so the clopening
  guard blocked her from Friday opening. Fix: Friday rest slots go to
  prayer-goers first (resting a Muslim man on Friday dissolves his
  conflict), prayer-free staff avoid Friday rests, and THURSDAY closing
  prefers prayer-goers so women/non-Muslims stay eligible for the
  Friday open. Lesson: a day-local rule isn't enough — the enablers
  (rest day, previous night's close) must also be steered.

- 2026-07-18 (round 8) — **Rest days are now PER-STATION (this branch).**
  Owner caught the two failure modes in one afternoon: (a) items-share rest
  placement dug holes PT then re-bought the same day ("hurm"/"fix this" —
  Tue got 3 PT while Sat ran short) → #975 replaced it with slack-greedy vs
  demand; (b) #975's day slack was STATION-BLIND: Sunday's barista side is
  the week's lightest so Sunday looked slack, two rests landed there, and
  person-assignment (weekend-debt order) gave BOTH to kitchen crew
  (Amirul+Azmer) on the #2 cooked-items day — 2 BOH for 86 kitchen items
  ("where is your logic?"). Fix: `placeStationRests(group, needOf,
  minOnDuty)` in schedule-generator — BOH FT rests judged only against
  `kitNeedHOf` (Σ kitHeadsByHour) with min 2 cooks/day (structural
  anchors), FOH FT against `barNeedHOf` (bar curve + SERVICE_FLOOR +
  buffer) with min 3; weekend fairness + variety + profile rest days now
  honoured within each station. Also this round (merged #965 #966 #967
  #975): PT ceiling envelope (FT floor ≥18% no longer starves weekends —
  amber publish), consignment_sales into forecast + history clamped to
  yesterday MYT (Nilai/IOI "no data" fixed), FOH/BOH item split in day
  headers, composition line + "Why this staffing?" panel, forecast rank
  explanations. Same PR, two more owner catches: (1) **demand window
  counted days that hadn't happened** — trailing-28d ran to weekStart−1
  with a hard ÷4, so generating on a Friday put tomorrow's (empty) Sunday
  and today's partial Saturday inside the window: Sunday PJ read 86 kit
  items when the true average of the 3 complete Sundays is 114 (−25%,
  always hitting the weekend). Window now clamps to yesterday MYT and
  divides each weekday by its ACTUAL occurrence count. (2) **Managers
  moved outside FOH/BOH** (owner: "their schedule does not consider as
  man hours, but can suggest shifts to cover if possible"):
  `MANAGEMENT_POSITIONS` (manager/AM/HoD — NOT barista lead) in
  labour-gate-lib; excluded from staffedAt (generator gaps), gate
  coverage `have`, candidates kitGot/barGot, and grid day totals; own
  grid section + timeline band + "MGR7.5 cover" tag; Assist now
  INCLUDES managers as bottom-ranked `manager_cover` candidates and a
  manager's + Add offers any short window as cover. Queue awaiting
  owner word: staff-app PT-loop parity, weekly autopilot cron, KDS
  handover briefing, Meta WA templates, demand v3 from timing
  worksheets.

- 2026-07-18 — **Custodian made SELF-DRIVING (owner: "what I wanted is for
  this agent to do this by itself").** Skill gains an **Autonomy ladder**
  (rung 1: code fixes/additive prod derivations/docs — do it; rung 2:
  pre-approved patterns — tier-1 narration+exact-amount re-points, unambiguous
  backfills, the delegated June GL correction once it reconciles to identity
  <RM500/company; rung 3: propose-only; rung 4: human — payroll/payments,
  arming, period close, merges) + procedure step 4b (each run BUILDS 1–3
  backlog items end-to-end, not just reports). Routine changed weekly→**daily**
  21:00 MYT (`trig_015cnJr3bfeXrjQ285nRjXNb`, fresh session; old weekly
  trigger deleted — its prompt contradicted the ladder). **CAVEAT: routine
  carries no MCP connectors (created via meta tool) — if tonight's run
  can't reach Supabase, recreate it from the claude.ai Routines UI.** Close
  pack (monthly) unchanged. Input-quality enforcement shipped same day:
  receiving API persists resolved package (root cause of 71% null coverage),
  accountant valuation pack (docs/proposals/inventory-valuation-anchors.md),
  close-pack COGS trust gates + check 25.

- 2026-07-18 — **Data-warehouse custodian expanded to the WHOLE estate**
  (owner: "this agent should be accountable for all the data"). Skill
  (`finance-warehouse` — historical path, description now estate-wide)
  gains domain contracts + checks 13–20 for HR, procurement/inventory,
  ops, marketing/loyalty, reviews/ads, comms, agent substrate; design doc
  gains the estate baseline + goals; migration 086 (APPLIED) broadens the
  registry row (key unchanged — stable identifier). Baseline sweep
  findings E1–E7: 935 open OpsAlerts; 107 POs AWAITING_DELIVERY (+4 SENT
  stuck, 1 DRAFT Jun 28); **sms_logs last row Jun 21 while SMS loops are
  ARMED** (channel dead or sends moved to push — top estate check);
  campaign_outcomes 0 rows (no loop writes outcomes); geogrid scans
  stalled since Jul 6; only 4/30 registry agents ever wrote
  agent_actions; 2 StockCounts SUBMITTED since Apr 30. Also: payroll runs
  now 6× paid (the 7/5 "all drafts" note is stale; fin_payroll_actuals
  stays canonical for cost). Weekly/close-pack routines inherit the
  estate scope automatically (prompts defer to the skill). **Next run
  priorities:** E3 SMS pulse root-cause, June per-company-day GL
  correction, E1/E2 aging policies.
  **COGS activation designed ("design 1", same day):**
  `docs/design/cogs-activation.md`. Discovery flipped the premise:
  recipes EXIST and are complete (`MenuIngredient`, 92/92 menus, 512
  lines, 138 ingredients, clean g/ml/pcs UOMs — earlier "no recipe
  tables" was a name-pattern discovery miss); `ProductPackage.
  conversionFactor` exists but only 29% of 2,070 ReceivingItems carry a
  package link; **consumption-post.ts reads DEAD SalesTransaction** (the
  shadow engine has multiplied recipes against zero sales since April);
  ReceivingItem has no price — unit cost derives from PO OrderItem.
  unitPrice ÷ conversionFactor. Workstreams W1–W5 (re-point sales →
  package ratchet + product_costs → menu_margins view → variance loop →
  pre-committed arming criteria for consumption_engine). Warehouse
  checks 21–24 added. **W1 BUILT same day (owner: "merge and build"):**
  consumption-post.ts now sources sales from pos_order_items (status
  completed, non-refund) + pickup order_items (paid statuses), both
  joined to Menu via storehubId (demand-model precedent); dead
  SalesTransaction read gone; new `itemsUnmapped` field surfaces items
  with no Menu mapping (live-verified Jul 17: 139–244 pos + 43–82 pickup
  items/outlet, only 3–8 unmapped per stream ≈ 4%). Engine stays SHADOW.
  Note: "Celsius Coffee Putrajaya" Outlet = the Conezion store (slug
  outlet-con) — 3 active till outlets, all covered. **W2/W3/W4 BUILT same
  session (owner: CONTINUE):** migration 087 APPLIED — `product_costs`
  VIEW (cost per base unit from last-5 received PO lines ÷
  ProductPackage.conversionFactor, override table
  product_cost_overrides; no cron — stays clear of the 40-cron cap),
  `menu_margins` VIEW (sellingPrice − channel-weighted recipe cost;
  uncosted_ingredients flags overstated margins; packaging cost = v1
  follow-up), and the W2 single-package backfill (848 ReceivingItems →
  package coverage 29%→70%). Verified sane: pastas RM19.90–29.90 at
  52–74% gross margin; 104/138 recipe ingredients costed (75%);
  data-map "Unit economics" section added. **Remaining in
  cogs-activation:** receiving-flow package default (code+UI), Catalog
  BOM page margin surface, packaging cost in margins, W5 variance loop →
  arming. **Next:** merge PR #970 (W1–W4); first shadow consumption
  report after tonight's cron.

- 2026-07-18 (round 7) — **Measured station capacity v2 (this branch).**
  Owner corrections while auditing Sat Jul 18: (a) "short" units clarified
  (hourly = concurrent heads, day chip = man-hours); (b) serve p90 signal is
  DIRTY at PJ — p50/p90 flat across quiet and busy hours, worst p90 at the
  dead 22:00 (44min) → docket hygiene, not load; (c) THE KEY ONE: staff work
  OVERLAPPING — 10/15min are order-latency promises, not per-item labour
  costs, so the p90 proportional controller (rates 8→4.8, 6→3.6) was
  over-demanding heads. Replaced with measured capacity: per (day,hour)
  items ÷ heads CLOCKED IN (hr_attendance_logs), hours qualifying only when
  median serve met target, p80 = demonstrated capacity, plan at 85%
  headroom, clamps [0.75×, 2.5×] base, base until ≥20 qualifying hours.
  PJ live: barista 11.1/head/hr (85h) → plan 9.4; kitchen 8.0 (82h) → plan
  6.8. Sat Jul 18 audit vs old roster: 12:00 double-middle sits on the
  demand lull while the 9am food peak ran at half strength (owner spotted
  it). Also this round: migration 084 APPLIED to prod; #963 (WhatsApp
  PT-loop flows) MERGED. Pending: staff-app parity screens, weekly cron,
  KDS "mark served at handover" briefing, Meta template submissions.

- 2026-07-18 — **Finance warehouse session 2 (owner-approved actions
  executed).** PR #948 merged; weekly routine scheduled
  (`trig_012njzLdT5jtaUQVG2JSrNgz`, Sun 21:00 MYT) + month-end close pack
  (`trig_017RGBQXACCqkRpQWknETpwW`, day 1 08:00 MYT) — both fresh-session;
  NOTE they carry no MCP connectors (created via meta tool) — if the first
  run can't reach Supabase, recreate from the claude.ai Routines UI.
  Executed on owner approval: (1) **tier-1 re-point batch: 92 bank lines
  re-pointed** (RM30,470.60, audit-stamped, classifiedBy='manual'); check
  11b residual now exactly 41 (tier-2, needs SOAs); the orphaned
  `paidVia='bank-ap-match'`-no-line phantom-paid review list (incl
  INV-1012 RM768, 26-0634/260634 RM148 pairs) awaits finance disposition.
  (2) **Pickup channel added to unified_sales** (migration 085 APPLIED;
  July: 1,347 rows RM41,649.74; view now pos+grabfood+pickup+consignment;
  data-map + skill updated; `unified_sale_items` still lacks pickup lines
  — follow-up; backoffice dashboard lib reads raw tables, unaffected).
  (3) **June unwind NOT applied — blanket reversal would be WRONG:**
  day-level reconstruction shows over-counting (Tamarind Jun 6–17, SdnBhd
  Jun 6–14: EOD posted full StoreHub days while bank-fed income ran) AND
  under-counting (Conezion Jun 8–17, SdnBhd Jun 15–17: EOD captured only
  pickup ~RM400/day, till ~RM3k/day went nowhere). Net error much smaller
  than the RM81k upper bound. Owner delegated ("make sure it is right") —
  per-company-day correcting entries are the weekly run's top item.

- 2026-07-16 -- **Finance data-warehouse agent designed** (branch
  `claude/celsius-finance-warehouse-agent-8j1uk6`): new `finance-warehouse`
  skill (custodian runbook: data contract w/ SLOs, 12-check suite, drift
  scan, close pack, `claude/finwh-` draft-PR findings loop) +
  `docs/design/finance-data-warehouse-agent.md` (verified 2026-07-16
  inventory, backlog F1–F7, 8 candidate goals — recommended starting set:
  freshness SLOs, lens bridge, restore eval dataset, month-end close) +
  migration 083 seeding `finance_warehouse` into agent_registry (shadow,
  **NOT applied** — human applies). **F1 root-caused + partially fixed in
  the same PR:** categorizer sits on the dormant `/api/finance/bills/upload`
  pipeline (fin_documents/fin_bills empty — never used; the live AP flow is
  procurement invoice-capture, which never calls it), and
  `logDecision`/`markDecisionApplied` swallowed supabase-js errors. Shipped:
  error handling fixed; ap-verifier (the live 6-hourly/EOM gray-zone judge)
  now logs every verdict to fin_agent_decisions (agent='ap-verifier',
  related_id=bank line, applied=true on committed EOM applies). Remaining
  F1 work: log invoice-capture extraction decisions + wire draft-invoice
  edits to recordCorrection (correction-shape design needed).
  **Run 1 executed 2026-07-17 (owner-triggered; migration 083 APPLIED to
  prod same session on owner instruction — finance_warehouse registered,
  shadow).** 9/12 checks green (ledger balanced, no orphan COA codes,
  cutover exclusivity exact, traps empty, 0 uncategorised bank lines).
  Findings: (W1) the wrong-invoice bank-match backlog is precisely **133**
  lines (check 11b query now canonical; was "~113"); (W2) 6 invoices
  paidVia='bank-ap-match' have NO linked bank line (inconsistent state,
  incl INV-1012 RM768 paid 6/16) + 95 Maybank-Transfer PAID (RM58k)
  awaiting EOM reconcile — 564 other unlinked are benign
  historical/backfill; (W3) **unified_sales.sst is dead — all-zero for all
  time** (data-map corrected; never compute SST from the till lens);
  (W4) drift: 082 fin_inventory_valuations was missing from the
  contract/data-map (added) and the table is EMPTY — Bukku Q1-close
  anchors never entered (owner/accountant action if the sourced P&L needs
  them). June lens bridge formalised: till 285,363.17 vs GL 353,851.53 =
  gap 68,488.36 → Grabfood 41,838.89 + GastroHub 12,441.54 + residual
  14,207.93 (~5%) ≈ card settlement lag — quantify next run (per-day card
  tender vs 5000-02). All findings logged to agent_actions.
  **Run 2 (same day, owner-triggered "continue"):** the lens bridge is now
  SOLVED — the GL income lens changed semantics at the POS cutover:
  5000-01/02/04 are EOD-journal-fed (accrual at ring-up) since ~Jun 6–18,
  bank-fed before; verified Jul 1–14 EOD income = till(pos+grabfood) +
  pickup-app − consignment with residual RM48; Grab delivery payouts now
  post to 1005 transit (not income). **Two material findings:**
  (1) JUNE GL income is mixed-regime — both bank-fed AND EOD posted income
  Jun 6–17, up to RM81,270.74 double-counted; unwind needed while the
  period is open (do not trust June GL revenue until then).
  (2) unified_sales VIEW excludes the pickup app (~RM40k/mo; `orders`
  money columns are in SEN) — "only sales truth" corrected in data-map.
  Re-pointing batch prepared propose-only in
  `docs/proposals/finwh-repoint-133-wrong-invoice-matches.md`: tier 1 = 92
  exact-amount narration matches (RM30,470.60, gated SQL), tier 2 = 41
  manual (RM21,251.98). **Next:** merge PR #948; owner/finance decisions:
  approve tier-1 re-point batch, June double-count unwind plan, whether to
  add pickup channel into the unified_sales view; schedule the weekly
  routine.
- 2026-07-17 (round 6, IN PROGRESS) — **PT loop build started
  (docs/design/pt-loop.md).** Merged this round already: #960 (PT gaps +
  targets from the demand model, station-tagged, structural anchor gaps)
  and #961 (demand model counts pickup-app `orders` — SA was missing 65
  items/day incl. +70% cooked workload; joins Menu via storehubId).
  Owner-driven PT-loop requirements: availability has NO write UI today
  (hr_staff_weekly_availability verified 0 rows), reserve empty spots as
  claimable open shifts, roster acknowledgment mandatory — over WhatsApp
  (Cloud API infra already wired: lib/whatsapp.ts + webhook) AND staff-app
  parity. Bilingual PT SOP memo drafted (sent to owner, start date TBC).
  Migration 084_pt_loop_ack_open_shifts.sql written (ack columns,
  hr_open_shifts, hr_wa_prompts; RLS enabled no policies per house rule) —
  NOT applied to prod yet, awaiting owner approval. Build order in
  pt-loop.md; next: WhatsApp flows PR, then generator open-shift emit,
  staff-app screens, weekly cron. Meta template approval needed for
  outside-24h pings — submit early.

- 2026-07-17 (latest) — **Round 5: forecast clamp (merged #959) + PT
  allocation unified with the demand model (this branch).**
  (a) #959: forecast history window now ends at YESTERDAY (MYT) — forecasting
  next week mid-week had been zero-filling the not-yet-traded tail of the
  current week at the highest recency weight, cratering Sat/Sun forecasts
  (SA/PJ Saturday showed ~RM3.0k vs real ~RM4.9k baseline). Surfaced by the
  owner asking how the weekend forecast works.
  (b) Shah Alam full-week QA (draft 2026-07-20) validated BOH: kitchen at
  open+close all 7 days, zero kitchen middles, no clopening, 45h caps, rover
  2 days, manager never rostered. But Mon–Wed FOH sat below the 3-head floor
  with NO PT suggested: `ptTargetByDate` still used the old
  items-per-man-hour "required" formula that disagreed with the coverage
  chips. Fixed: PT gaps + day targets now come from THE demand model
  (station-split heads incl. floor + mode buffer), gaps are station-tagged
  (kitchen holes only offered to kitchen-capable PT; hybrid "PT
  Barista/Kitchen" fits both), and structural anchor gaps (2/station on
  opening & closing) let PT complete the 2/2 kitchen anchors when only 3
  kitchen FT exist (Haziq → kitchen Closing instead of a random Middle).
  Greedy fallback, model-proposal validation, and the PT model prompt all
  enforce/see the station. Next: autopilot phase 2 (weekly cron
  generate→validate→shadow-publish) awaits owner "continue".

- 2026-07-17 (later) — **Scheduler round 4: per-station allocation + Assist
  rebuilt (PR #957, branch `claude/staff-rotation-outlets-kmobpa`).** One
  demand model (`lib/hr/demand.ts`, extracted from the generator) now feeds
  generator + labour-gate coverage + grid "short Xh" chips + Assist. Owner
  directives closed this round: (1) BOH middles were surplus artifacts —
  day-split now runs `allocateShiftCounts` **once per station** (kitchen crew
  on the kitchen item curve, FOH on the barista curve + service floor + mode
  buffer; pastries/croissants/cakes/cookies are barista — verified against
  live Menu categories, only the 6 cooked categories are kitchen). Owner
  refinement: anchors are STRUCTURAL for both stations — open carries
  prep/setup, close carries cleaning + dishwashing — so each station seeds
  up to 2 opening AND 2 closing (`allocateStationCounts`,
  STATION_ANCHOR_TARGET=2; 1 head opens, 2→1/1, 3→2/1, 4→2/2) before its
  item curve places anyone; only heads beyond 4 follow the curve
  (regression-tested in shift-allocation.test.ts). (2) Assist QA'd — it was NOT following the same
  logic: it ranked the Manager as Top pick (pool now excludes
  Manager/AM/HoD; Barista Lead stays), its coverage chips read
  hr_outlet_coverage_rules with a min-concurrent-over-16h bug ("0/4 short 4"
  with 11 rostered) — chips are now per-template needs from the demand model
  with per-station gaps ("short 1 kitchen + 1 barista"), and clicking a
  single-station gap auto-fills the role so skill-weighting favours that
  station. (3) UX: grid cell "+ Add" now leads with "✨ Suggested" — the
  short templates for that person's station, one click to assign (lazy
  per-date fetch of /api/hr/schedules/candidates, cache cleared on save).
  Remember the deploy-lag gotcha before believing "it didn't work".
  Still open: two deep-QA review agents from round 3 never reported back;
  autopilot phases 2–4 (cron generate→validate→publish shadow-first,
  WhatsApp exception digest, PT auto-commit) designed but not built.

- 2026-07-17 — **Scheduler QA round 3 (owner-driven), all merged to main.**
  #953 (squash `9544c2f`): day-split rebuilt — shift COUNTS from the hourly
  items curve via `lib/hr/shift-allocation.ts` (marginal-shortfall greedy;
  killed the clopening cascade that starved opening at 2 / stacked closing
  at 6); all FT filled in every mode (shared FT to 6-day combined cap, rover
  2 days); Managers/Area Managers never auto-scheduled; rotation cost follows
  hours (`borrowedFtCharge`/`lentFtCredit` — borrowed FT charged here,
  credited at home; Barista Lead pro-rata; manager cost = HQ RM0, flat RM309
  rover share dropped); generator uses real per-profile EPF rates; daily grid
  % = day's hours-share of ACTUAL roster cost (reconciles to the weekly chip).
  Verified live: all FT/PT salary data individually populated; Afique
  RM1,900 → RM438/wk charged where he works. **Gotcha that bit twice:** owner
  regenerates immediately after merge, but Vercel prod deploy lags ~3-6 min —
  check `ai_notes` for the current marker line (now "rotation cost follows
  hours") before diagnosing "the fix didn't work". Follow-up branch adds
  FOH/BOH section grouping in the week grid. Two deep-QA review agents were
  still in flight at last update — triage their reports on return.

- 2026-07-16 — **Ads optimizer + local-rank status check (all DB-verified,
  follow-up to the 2026-07-05 entry).**
  **Optimizer:** the two Jul 5 owner-approved cuts (Tamarind RM100.20→84.96/day,
  Putrajaya RM100→98.42/day, ~RM504/mo freed) applied clean and are sticking —
  per-day cost/conv Jul 5–14 vs the prior 2 weeks: Tam RM13.4→9.4, PJ RM9.4→7.6,
  SA (uncut) RM6.2→6.1, with conversions/day flat-to-up at all three. No further
  budget changes; 0 search-term exclusions ever used. July spend to date
  RM7,296 (3 campaigns ≈RM100/day each). **BUT the conversion signal is still
  wrong:** `ads_conversion_daily` confirms the tracked actions are *Local
  actions – Directions* + *Clicks to call* (and that per-action sync is stale —
  no rows after 2026-04-19). The value-based "Pickup Order" tag
  (`docs/design/ads-conversion-loop.md` Approach A) was never wired, so the
  optimizer's efficiency lens = cost per directions-click, not cost per order.
  **ads-daily sync** healthy nightly (metrics through Jul 14) EXCEPT the
  search-terms step: its sync-log rows are stuck `RUNNING` every night (finish
  update never lands) and Jul 12 threw a hard Prisma connection-pool timeout;
  data still arrives (10.5k rows / 4.9k terms, Jun 29→Jul 13) — likely serial
  upserts racing maxDuration/pool. Owner's search-term **backfill curl never
  ran** (history starts Jun 29). The Monday shadow-optimizer report exists only
  in the cron's JSON response — persisted nowhere, read by no one.
  **Geogrid:** the first true-10km auto-scan (Mon Jul 6) burned the ENTIRE
  monthly cap in one run — 40 scans: 13 complete / 7 partial / 20 failed with
  0/81 points (later scans in the run all failed → Places quota/rate
  exhaustion; failed scans still persist rows and count against
  `GEOGRID_MONTHLY_SCAN_CAP`). The Jul 13 Monday run was a capped no-op;
  **nothing scans again until Aug 1.** Structural mismatch: 86 active
  keyword×outlet combos on a ~weekly due-cadence vs a 40/month cap — the loop
  as configured can never complete a sweep. Tamarind got ZERO usable catchment
  baselines. Usable Jul 6 baselines: SA "breakfast shah alam" avg 3.9 / 33%
  top-3 / green 11.2km; PJ "cafe" 5.3 / 12% / 5.0km; Nilai "nilai cafe" avg
  17.2 / 0% top-3 (invisible in its own town).
  **Reviews (the rank lever):** snapshots current through Jul 16. 30-day
  velocity: Tam 49 (the GBP relink fix is vindicated), PJ 29, SA 13, **Nilai 3
  — still the binding constraint** (111 reviews vs top local competitor 160).
  **Substrate gap:** none of ads-daily / optimizer / geogrid are in
  `agent_registry` (only the `reviews_*` agents) — no kill switch, no ledger.
  **GBP category adds** (the Jul 5 "next") were never proposed — blocked on
  the failed scan coverage.
  **Next:** (1) fix geogrid scan economics — don't count failed scans against
  the cap, throttle within a run, and prune the 86-keyword set to fit the
  budget (or raise the cap knowingly: ~81 Places calls/scan); (2) owner
  decision: wire the value-based Pickup Order conversion (Approach A) or
  accept directions-clicks as the metric; (3) re-propose GBP category adds
  once Tamarind has a real catchment scan. (Items on the optimizer shadow
  report, search-term batching, and registry registration were superseded the
  same day by the ads autopilot — next entry.)

- 2026-07-21 — **Negative-keyword CONSOLIDATION (owner: "check if there is
  still bad keywords paid" → "go ahead").** Found all 3 campaigns at 25/25
  negative slots with ~RM170/mo junk still paid + stuck (slots full → last 2
  runs excluded 0). Root cause: slots burned on literal near-dupes. Fix:
  exclude broad ROOTS not literals (`negativeThemeRoot`/`exclusionPhrase`;
  "zus" covers "zus near me"+"zus coffee" fuzzily + pre-blocks future
  variants), `selectAutoExclusions` sums spend per root, one-time idempotent
  `consolidateCampaignNegatives` swaps existing 25 literals→roots in the armed
  nightly pass (removes literals=frees slots, adds roots, ledger
  status='superseded'). Verified: applied exclusions DO stop spend (≤RM1.89
  one-day propagation tail, not a leak); sync healthy (Google's ~2-day
  search-term reporting lag, latest data Jul 19). Root lists exclude bare
  "coffee"/"cafe" so café intent is never blocked. 483 tests green.
- 2026-07-21 — **Hard-cut APPLIED + EFFECT.** Jul 20 run cut all 3 campaigns
  to RM55/day clean (fleet RM265.86→165). Cuts banked RM4,056/mo = 81% of
  RM5k. Till post-cut Jul 21 = RM6,660 fleet, inside normal RM6.5–8.4k band —
  no cliff, but 1 day (guard verdict ~2wk). Scoreboard sales side still
  contaminated (StoreHub anchor, shows −RM10.6k/mo — ignore). Owed: remove the
  one-time hardCutDirective block; fix scoreboard anchor; if till holds, take
  fleet toward RM45/day each for the last ~RM950/mo.
- 2026-07-19 — **Hard-cut directive (owner: "what do you suggest" → "ok do
  this"):** one-time decisive cut of all 3 ad campaigns to RM55/day
  (`hardCutDirective`, env ADS_HARD_CUT_TARGET_MYR) — banks ~RM4,050/mo of
  the RM5k target at once instead of over ~2 months, then the normal guarded
  descent + rollback continue. Fires only on a healthy measured till (raw
  index ≥0.95; a weak/unmeasured outlet waits a night), only while >target,
  self-expires per campaign at RM55. My reasoning: 11% cut so far moved the
  till 0 → strong evidence marginal spend is waste; RM55 (not the floor)
  keeps a real budget each outlet can defend so a genuine sales effect shows
  up as a manageable dip, not a cliff. **Remove the directive block in a
  follow-up once all 3 are confirmed at RM55.** Fleet after tonight: 265.86→
  165/day.
- 2026-07-19 — **Descent aggression BUMPED (owner: "decrease more")** after
  first cuts proved safe (fleet RM300.20→265.86/day = RM1,030/mo banked, ~21%
  of RM5k; per-outlet guard healthy; clean-POS till flat ex-Shah-Alam which
  tracks the Grab holdout + seasonality). Steps 8→12% (inefficient 12→18%),
  max cuts/run 2→3, fleet spacing 6→3d; all env-tunable (ADS_STEP_PCT etc).
  OBSERVE_DAYS kept 14 (= guard window). NOTE: the cash scoreboard's SALES
  side is contaminated — its anchor window (28d pre-Jul-5) straddles the
  StoreHub→pos-native cutover, so it over-reads the "before" till (logged
  -RM9.9k/mo till Δ vs clean-POS ~-RM170/day). Cuts side is correct. Fix
  offered (anchor to post-cutover window / exclude storehub_sales), owner
  hasn't said go yet.
- 2026-07-19 — **Cash TARGET (owner, revised): +RM5,000/month net from
  GOOGLE ADS ONLY** (was RM7k any-source; SMS/loyalty loop proposed and
  PARKED — 23k member phones sized, design in sms-loop-engineering.md,
  awaiting owner's return to it). Nightly `cashScoreboard()` in the autopilot logs
  progress (cuts vs RM300.20/day pre-descent baseline + margin on fleet till
  drift vs the pre-descent anchor) in every run's summary + meta. Current:
  ~RM1,030/mo banked from cuts (~15%). Cuts ceiling ≈RM6.4k/mo → the sales
  side is required; biggest dormant lever = value-based Pickup Order
  conversion tag (still unwired).
- 2026-07-18 — **Ads spend autopilot LIVE — full design + history promoted to
  `docs/design/ads-autopilot.md`** (PRs #947/#952/#954/#971/#972/#973, all
  merged; built 7/16-18 from owner directives: no per-change approval,
  maximize cash with the till as sole truth, exclude junk then cut its cost,
  full-pause Tamarind for a baseline). Nightly inside `cron/ads-daily`;
  kill switch `agent_registry` key `ads_autopilot` (armed); every action in
  `ads_budget_change`/`ads_term_exclusion` as decided_by='ads-autopilot'.
  **Live state after the first run (Jul 18 3am MYT, ledger-verified):**
  Putrajaya RM92.79/day (waste-matched cut paired with its 15 junk-term
  exclusions), Shah Alam RM92 (first blind 8%), Tamarind RM100.20 (rollback
  that channel-decomposition proved a FALSE POSITIVE — till flat in absolute
  RM; led to the #972 plausibility bound). 45 negatives applied incl. fleet
  seeds to SA/Tam. **Tamarind pause was BLOCKED twice** (Jul 18: probe gate required a fully
  healthy guard, fixed in #973; Jul 19: the human-paused NILAI campaign
  tripped the one-probe-at-a-time check, and nightly waste-matched cuts
  were resetting the fleet-spacing clock — starvation bugs). Fixed: the
  one-probe check counts only autopilot-paused campaigns; waste-matched
  cuts don't reset the spacing clock; pauses are never spaced. **PLAN CHANGED (owner,
  Jul 19): pause probe SHELVED — "let tamarind follow the others, start with
  the prev cut (rm80+)". One-time owner directive in code cuts Tamarind
  100.20→84.96 at the next nightly run (self-expiring: fires only while the
  false-positive rollback is the last ledger row), then Tamarind runs the
  same gradual descent as PJ/SA. Probe machinery kept, re-enable via
  ADS_AUTOPILOT_PAUSE_PROBE=on.** (Superseded text: Tamarind 28d baseline
  (probe gate now blocks only on absolute till weakness, #973) →
  auto-restore + verdict ~Aug 15 — drop → ads generate cash; none → floor.) Competitor + dessert
  junk classes armed (owner: no conquesting), Malay/local vocab added,
  25-negative-slot budget per campaign. **Watch items:** Tamarind verdict
  ~Aug 15; SA/Tam term data accumulating (waste-matched cuts follow);
  fuzzy negative themes may catch café-intent terms (seen: "kopitiam near
  me") — reject via /ads/optimizer panel to make it permanent; possible
  GrabAds holdout at SA/Tam is a confound for till reads. **Still open
  (owner):** value-based Pickup Order conversion tag (Approach A) — Google
  still optimizes toward directions-clicks; geogrid scan-cap economics
  (separate loop, idle until Aug 1).

- 2026-07-15 -- **Staff-scheduling round 2 (branch
  `claude/staff-rotation-outlets-kmobpa`, PR #938, draft).** Builds on the
  merged #934 (multi-outlet rotation + demand-sized AI Fill + fairness). Two
  additions: (1) **Tight/Mid/Safe staffing-mode toggle** — a coverage buffer on
  top of the demand-sized heads via one lever `bufferHeads(dow,hr)` in
  `schedule-generator.ts` (tight=0 → byte-for-byte prior behaviour; mid=+1 across
  the day's peak block; safe=+1 all open hours). Chosen in the Schedules toolbar
  dropdown beside AI Fill; validated in `api/hr/schedules/route.ts`; recorded in
  `ai_notes` + returned on the result. (2) **Performance-aware PT suggestions** —
  new `lib/hr/pt-performance.ts` computes a 60-day reliability score (on-time from
  `hr_attendance_logs` 60/40 checklist-completion from `Checklist`, Bayesian
  prior 0.7-0.8/K3, never a hard gate); folded into both the greedy fallback
  (blend perf 0.5 + live-fairness 0.35 - cost 0.15) and the LLM prompt. Docs:
  `docs/design/staffing-model.md` updated. No schema change (break *times*
  deliberately out of scope — placed case by case). All 354 tests + tsc + lint
  green. **Next:** await CI on #938, then a live test-generate of one week per
  mode to eyeball the labour% deltas before marking ready.
  **Round 2b — revenue forecast rebuilt.** Diagnosed why AI wk 7/20 read 20.5%
  at fewer hours than published wk 7/13 at 18.2%: labour% = cost ÷ forecast, FT
  salary is a fixed sunk cost (RM4,616 + rover 309 = RM4,925, unmoved by hours),
  and wk 7/20's forecast was ~16% lower (RM23,814 vs ~RM28,500) because the flat
  trailing-28d÷4 forecast lagged a falling trend → PT envelope computed to RM0
  (no PT suggested). Fix: new `lib/hr/revenue-forecast.ts` (pure, 6 tests) —
  per-weekday, recency-weighted (½-life 2w), holidays excluded from baseline +
  applied to target week via the outlet's own holiday ratio. Wired into
  `labour-gate.ts` (`dailyRevenueSeries` + `forecastWeek`; gate `coverage[]` now
  carries per-day forecast/pct/weekend/holiday) and the generator (per-DATE
  affordable man-hours + holiday note; one forecast feeds both sizing and the
  envelope). UI: per-day forecast + indicative % in the week-grid day headers and
  the DayView badge. Verified new query reproduces the old flat forecast to the
  ringgit (flat-weight == 28d÷4). All 360 tests + tsc + lint green.
  **Round 2c — FT sunk cost made explicit.** Because FT salary is booked whether
  or not they're rostered, benching an FT to cut the % saves nothing. Gate now
  splits rosterCost into `ftFixedCost` (FT+rover, sunk) + `ptCost` (discretionary),
  the labour-chip tooltip shows FT-floor% vs PT%, and it warns when a primary FT
  is scheduled ≥2 days below their 6-day capacity (net of leave). Generator flags
  a revenue-constrained week (FT floor alone ≥ target, PT envelope RM0). Cross-
  outlet FT lending noted as the larger follow-up (not built). **PR #938 merged
  to main 2026-07-15** (squash) → Vercel backoffice deploy.
- 2026-07-15 — **Stock-count coverage guard (short-count guardrail).** Root: the
  staff submit/finalize endpoints trust the client's item list; the only
  completeness check was per-item (`countedQty` null), which can't catch products
  never loaded onto the sheet — how Putrajaya's monthly landed at 49 of ~212
  (an abandoned 7-minute DRAFT; its Apr 30 monthly had 212, May/June monthlies
  skipped entirely). New pure `evaluateCountCoverage` in `packages/db/stock-count.ts`
  compares counted vs the outlet's expected universe for that frequency; interim
  baseline = the fullest recent REVIEWED count of the same frequency
  (`apps/staff/src/lib/stock-coverage.ts`). Owner call (block vs warn): **MONTHLY
  below 85% coverage → BLOCK** (unless an explicit `partialReason`, which routes it
  to review with a note); **DAILY/WEEKLY → WARN** (allow but force SUBMITTED +
  short-count note, never auto-approve). Wired into both entry points
  (`api/stock-checks` POST + `.../[id]/finalize`). 14 unit tests green, staff tsc
  clean. **Follow-ups (not built):** backfill `OutletProduct` (has per-product
  `countFrequency` — the real source of truth vs the interim baseline) and seed
  counts from it; an ops-pulse detector to ping on any submitted short count; UI
  progress vs the expected universe ("49 / 212") + a "Submit partial count" action.

- 2026-07-15 -- **Agent substrate SHIPPED end-to-end.** Fleet review found the
  non-compounding pattern (every domain reinvented flags/queues/telemetry;
  shadow builds never armed; marketing loop has no outcome memory). Built the
  shared rails: migrations `080_agent_substrate.sql` (agent_registry +
  agent_actions ledger + campaign_outcomes) and `081_agent_registry_seed.sql`
  -- both **APPLIED to prod 2026-07-15** (29 agents: 17 armed / 8 shadow /
  4 off; advisor shows only the intended RLS-no-policies deny-all note). Lib
  `apps/backoffice/src/lib/agents/substrate.ts` (getAgentMode fail-safe off
  for NEW agents, getAgentModeOrDefault fail-open for pre-existing live
  loops, logAgentAction never throws); `/agents` control panel (Settings >
  System > AI Agents, OWNER/ADMIN; API refuses mode=armed while
  arming_criteria is NULL). Exemplar wiring: celsius-overview +
  reviews-auto-reply log to the ledger; ap-match-apply + gl-post gained
  their first kill switch (registry mode, fail-open armed). NOTE: main's nav
  moved to `apps/backoffice/src/lib/nav.tsx` -- the AI Agents entry lives
  there, NOT in layout.tsx. Compounding build contract now gates new agent
  ideas via the office-hours skill (Phase 1.5) + design-doc "Compounding
  Contract" section. Branch `agents-substrate`. Human owes: arming criteria
  for the 8 shadow agents. Next: wire round_gap_loop + sms_lifecycle_loops
  to campaign_outcomes; migrate legacy env-flag readers to getAgentMode.

- 2026-07-14 — **Housekeeping agent designed** (branch
  `claude/housekeeping-agent-design-p3ux4g`): new `housekeeping` skill —
  evidence-gated cleanup loop on the sentry-triage pattern (fresh session
  per run, state in GitHub via `claude/housekeep-*` draft PRs, ≤3/run,
  propose-only for DB/infra/product-behaviour, human-only for
  payments/secrets). Design: `docs/design/housekeeping-agent.md`. Seeded
  backlog: stale launch.json, root package.json dead scripts
  (`typecheck:apps`→apps/loyalty, `db:push` footgun), staff-native coach
  helpers (ride-along), STATE compaction; propose-only: pickup inventory
  tab. Round 2 (owner): added the **utility audit** — a monthly zombie
  sweep (working-but-unused / purpose-defeating: shadow limbo, producers
  without consumers, half-built loops, noop resolvers) judged on
  usage/outcome evidence, propose-only, verdicts arm/kill/park-with-
  expiry/keep, seeded zombie register in the skill. **Next:** merge,
  then trigger the first run on demand; schedule the weekly routine
  (Sun AM MYT) only after run 1 proves useful.

- 2026-07-14 — **Paid-no-POP audit → 6 payment-record corrections applied to prod**
  (owner-approved in chat; SQL via Supabase MCP, audit notes stamped on every
  touched row, re-pointed bank lines set `classifiedBy='manual'` so the matcher
  won't re-touch them). Verified against the bank feed (current through Jul 12):
  KLFC **00653452** RM768 reverted PAID→PENDING (phantom bank-ap-match — paid
  stamp Jun 16 predates the Jun 19 issue date; that debit narrates 00652052);
  KLFC **00655541** RM768 stalled INITIATED→PENDING (initiated but never
  confirmed; no debit names it, zero unmatched RM768 since Jun 1); Blancoz
  **26-0677** RM148 reverted PAID→PENDING (the Jul 8 debit narrates 26-0676);
  bank lines re-pointed/linked by narration: Jul 5→26-0644, Jul 8→26-0676,
  Jul 10→26-0675 (and 26-0675 paidAt corrected Jul 5→Jul 10). Net: RM1,684 back
  in payables (KLFC 1,536 — cross-check their SOA before paying — + Blancoz 148).
  These 6 are the first slice of the ~113 historical wrong-invoice matches; the
  bulk re-pointing pass still needs its own finance-approved run.

- 2026-07-11 — **Backoffice nav housekeeping (round 4)** — nav registry gains
  `hidden` items (in ⌘K/route-gate/grants, out of the sidebar; see
  `lib/nav.tsx` NavItem doc). Evidence-based prune (every hide verified
  reachable via in-page link or HR tab strip, or is audit/config-grade):
  HR 17→7 sidebar entries (one per module — strips reach siblings, verified
  unfiltered by moduleAccess), Ops Dashboard hidden (same API as Performance,
  which is the superset + new section landing), SOP Categories moved to
  Settings→System, Recipe Cards/Points Log/Outcome Types/Settings Hub hidden.
  Finance "Legacy" group renamed **Cash** — cashflow + cash-tracking are the
  actively-maintained cash-basis lens, NOT deprecated (verified in code; do
  not prune them). Kept after verification (distinct tools, sidebar-only
  reach): Compare, Cashier Performance, Inventory Reconciliation, Rank
  Scoreboard, Ads Optimizer.

- 2026-07-11 — **Sentry self-fixing loop** (branch
  `claude/sentry-self-fixing-loop-5tdrxm`): `sentry-triage` skill upgraded
  from one-way triage to a closed loop — per-issue draft-PR fixes (branch
  convention `claude/sentry-fix-<shortid>`, ≤3/run), next-run verification
  of merged fixes against live Sentry (quiet → resolve issue w/ PR link;
  still erroring → one `-r2` retry; then escalate here), state reconstructed
  from GitHub PR search + Sentry status (no repo ledger). Design:
  `docs/design/sentry-self-fix-loop.md`. The existing nightly routine
  (`trig_01NZbJV3A36TeXRKpBkFjxWx`, 05:00 MYT) picks the new procedure up
  automatically once merged — its prompt defers to the skill file. **Blocked
  on the sentry.io egress allowlist fix (see Open failures)**; after the
  owner fixes that, note: 2 of the week's top 3 issues were already
  root-caused WITHOUT Sentry via Vercel runtime logs (see the two
  2026-07-11 Open failures — both are missing Vercel env vars, human
  actions). Remaining for the first live run: `TypeError: Cannot read
  property 'toFixed' of undefined` (5 events, New — needs the Sentry stack
  trace to localise), then verify the two env fixes landed (issues go
  quiet → resolve them in Sentry per the skill).

- 2026-07-10 — **Backoffice nav UX rework** (PR #894, merged on owner's
  approval after a clickable preview artifact). Owner said the tabs were
  "haywire". Nav config extracted from `(admin)/layout.tsx` into
  `src/lib/nav.tsx` (single registry shared by sidebar + ⌘K palette + route
  gate). Behavior: section headers open AND jump to the section's first page
  (expand-only shipped briefly in #894; owner reverted it next day — clicking
  a tab must navigate; keep it), clicking the open active section collapses
  it, section highlight stays on while open, mobile sheet closes on page
  pick. Structure: rail reordered into clusters (Sales/Procurement/Ops ·
  HR/Finance · Rewards/Marketing · Catalog/Settings, with rail dividers —
  `dividerBefore` was previously dead config, now rendered); duplicate
  Packaging entry removed (single home: Catalog); GrabFood folded into
  Marketing → Advertising; ordering labels were briefly swapped to
  "Supplier Chats"/"Purchase Orders" but the owner reverted them next day —
  the team's vocabulary is **"Purchase Orders" = supplier-chats page,
  "PO List" = /inventory/orders**; keep it;
  single-item subgroups merged (HR Leave→Time & Leave, Rewards Manual
  Grant→Channels, Settings People→Business, Procurement Analytics→Overview);
  HR icon Bot→Users. ⌘K palette now searches nav pages (RBAC-filtered) above
  employees. **No URL or moduleKey changes** — perms dev-guard still covers
  every grantable key. All verified: tsc, eslint (3 pre-existing warn-level),
  347 vitest, next build. Round 2 (owner: "sub tabs need arranging too"):
  Sales/Ops/Finance flat lists → subgroups (Overview/Daily/Reports,
  Overview/Daily/Setup, Books/Reference/Legacy), Catalog reordered
  products→BOM→cards→packaging→posters. NOTE: GitHub Actions dropped the
  `synchronize` CI runs for the round-2 pushes (only the first commit got a
  PR run); verified locally (tsc/eslint/vitest) and via the on-merge main
  CI run instead.

- 2026-07-10 — **Procurement loop QA round 2 + "fix all"** (PRs #883 #885 #891
  #895 merged; earlier same-arc: #714 par ABC value-cap, #806 cold-send fixes,
  #835/#836 invoice-capture approve flow). Root findings: the cron cap (see
  facts), invoice/receiving tail leaks (revisions dropped, PARTIALLY_RECEIVED
  chase black hole, Cancel deleting the GRNI payable, chaser suppressed by
  placeholders, EOM matcher paying DRAFTs) — all fixed; ASSIST fidelity (wrong-PO
  target, multi-item proposals lossy, ETAs dropped, untruthful resend, double
  replies) — all fixed. Pars recalced in prod for all 3 POS outlets via SQL
  mirroring par-calc.ts (fresh 2026-07-10, ABC classes; weekly cron takes over
  Sundays). **Still open:** webhook runs 3 sequential LLM calls before Meta's
  200 (throttling risk — needs its own PR); ~113 historical wrong-invoice bank
  matches need a finance-approved re-pointing pass; invoice_request template
  still needs one OWNER visit to /api/ops/workspace/templates?action=create to
  submit to Meta.

- 2026-07-06 — **Checklist auto-assign: data-driven FOH/BOH station** (PR #824,
  branch `claude/auto-assign-checklist-hqqzfd`, draft — NOT yet merged). Root
  cause of "auto-assign didn't assign the attended person": station came from a
  hardcoded title map in `ops-nudges` that mis-classed *Ice Machine Cleaning* as
  kitchen (it's at the bar → FOH). Now data-driven both sides: `Sop.stations`
  (enum `SopStation{foh,boh,lead,shared}`, **array/multi-select** — a SOP can be
  FOH+BOH or shared) + `hr_employee_profiles.station` (text, nullable = infer
  from position). Auto-assign pools anyone matching ANY of the SOP's areas
  (`matchesAnyStation`); explicit employee station overrides position;
  `STATION_POSITIONS` foh←barista/cashier, boh←kitchen. UI: multi-select on SOP
  create+detail pages; FOH/BOH/lead selector on the employee Employment card.
  **Both migrations APPLIED to prod + verified 2026-07-06** (`sop_station`,
  `hr_profile_station`); today's 3 ice-machine rows repointed to FOH baristas.
  **Still open:** merge+deploy PR #824 so the new routing runs (until then the
  OLD armed cron/JIT still uses the kitchen map — the old JIT could re-own
  tonight's ice machine to kitchen only if the FOH assignee never clocks in).

- 2026-07-05 — **Staff access-control audit + hotfixes** (`docs/staff-access-
  audit-2026-07-05.md`). Application-layer RBAC audit across POS login, staff
  app, checklists, stock count, receiving, own audit/performance, backoffice,
  and the cross-app identity layer. Root cause: enforcement copy-pasted inline
  into ~470 routes, 3 divergent `getSession`/`requireRole` impls, client-only
  module/UI gates. Much was fixed in parallel: #697 (order `/api/staff/*` +
  staff dashboard/products/settings auth), #802 (anon RLS surface 24→0), #799
  (vitest `@/` alias). This session added: **decommission** of the retired
  order `/staff/*` web surface + dead feed routes (kept `staff-token.ts` +
  `/api/orders/[orderId]/status`, load-bearing for pickup-native collect), and
  **staff hotfixes** (audit `[id]` read/write scoping, `transfers/[id]`
  outlet check, `switch-outlet` outletIds, dashboard outlet-pin). **Still
  open:** C-2 (POS `verify-manager` PIN oracle, OTA-coupled), H-1 (backoffice
  `ops/audit-*` reachable by STAFF cross-app token — wrong `getSession`
  import), H-4 (MANAGER over-reach across ~150 `requireAuth`-only backoffice
  routes), H-5 (session revocation unwired), M-1 (`CUSTOMER_JWT_SECRET`
  fallback). Durable fix = the `withAuth({roles,module,scope})` guard + CI
  check in §5 of the doc (not yet built).

- 2026-07-05 — **Ads + local-rank loop hardened** (PRs #732/#751/#781/#783/#797
  all merged): budget-cut optimizer live at `/ads/optimizer` (waste tier +
  efficiency trims vs fleet-best cost/conv, `ads_budget_change` ledger applied
  to prod, approval-gated, weekly shadow inside `ads-daily` Mondays); keyword
  strategy board at `/reviews/geogrid/keywords` (own/focus/prominence/retire,
  opportunity-sorted). **Measurement bugs fixed:** `ads_campaign.status` stores
  Google's numeric enum ("2"=ENABLED) — filter with `ENABLED_STATUSES`; the
  geogrid auto-scan defaulted to 0.2mi (storefront) — now 1.5534mi = the ±10km
  catchment; keyword buckets only trust complete catchment-scale scans (Nilai's
  "owned" verdicts were 0.1mi artifacts). **Tamarind was wired to Shah Alam's
  GBP location** (poisoned snapshots Jul 3–5, deleted from prod; the fake
  160.6/day velocity was the count-jump): `reviews-daily-snapshot` now
  self-heals `gbpLocationName` nightly by matching `gbpPlaceId` (set for all 4
  outlets from verified scan/QR evidence) against `listAccountLocations`;
  on-demand check at `/api/reviews/gbp-relink[?apply=1]`. **Lever validation:**
  categories = strongest rank lever; review velocity ≈20% and the binding
  constraint (Nilai 2/30d, SA ~11, Tam ~17, Putrajaya 34); GBP description is
  NOT a rank factor — stop treating geo-in-description as a rank play.
  Status refreshed 2026-07-16 — see that entry below for where the loop
  actually stands (scan cap exhausted, conversion signal still wrong).

- 2026-07-05 — **People-cost gating loop shipped** (PRs #765/#780/#785 all
  merged): labour gate + publish enforcement (green/amber/red, per-outlet
  budgets Con 16/18, SA 18/20, Tam 22/25 interim), editor badge + per-day
  coverage chips, PT bank-line outlet tagging, Monday variance digest
  (`cron/labour-variance`, SHADOW — flip `LABOUR_VARIANCE_MODE=armed` after
  one sane Monday), and a rule-based+agentic AI Fill (DB templates, FT 45h +
  rest days, rovers 2 days/outlet, PT as amber `pt_suggestion` cells inside
  the budget envelope). Design + verification:
  `docs/design/people-cost-gating-loop.md`. Humans owe: profiles for the 4
  orphan staff, finalise 6 draft payroll runs, confirm Tamarind 22/25.

- 2026-07-04 — Harness scaffolding rounds 1+2 done: root `CLAUDE.md`, this
  file, skills `{db-migration,ota-release,procurement-e2e,finance-module,
  sentry-triage}`, workflow `.claude/workflows/rls-audit.js`, and a nightly
  Sentry-triage routine scheduled (05:00 MYT, fresh session per run —
  manage via the Routines/triggers list).
  Next candidates: run the `rls-audit` workflow and act on the report;
  build the finance eval replay (corrected `fin_agent_decisions` rows →
  regression set per agent, see finance-module skill); wire cron heartbeat
  monitors (`docs/monitoring-setup.md` §2).
- 2026-07-05 — Hardening batch shipped: pickup-page reads moved server-side,
  `related_id`/`applied` fixes, `reconcile-pending` Sentry heartbeat,
  `docs/ops-hardening-checklist.md` (human dashboard items + quarterly
  key-rotation calendar reminder on barista@, next 2026-10-01), and the
  loyalty policy-fix proposal in `docs/proposals/`. **Waiting on human:**
  apply the proposal SQL after deploy (checklist §5), `hr_payroll_runs`
  RLS one-liner (§6), IP allowlist (§1), BetterUptime + Vercel→Slack (§3),
  PITR decision (§4). SMS attribution holdout (loop #1) still needs the
  two owner decisions: exact reward + success bar
  (`docs/design/sms-loop-engineering.md`).
