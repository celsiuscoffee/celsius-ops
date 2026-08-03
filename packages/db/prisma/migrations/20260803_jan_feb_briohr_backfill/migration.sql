-- Backfill the three payroll lines the BrioHR Jan/Feb import dropped.
--
-- Owner 2026-08-03: "yes, re-import from briohr" / "update the montly computed
-- payroll (jan and feb)". Source: the two exports the owner uploaded,
-- 202601_payroll_report.xlsx and 202602_payroll_report.xlsx.
--
-- WHY: the deleted `opening_balance` run carried BrioHR's Jan-Jun YTD. Rather
-- than rebuild it, complete the Jan and Feb MONTHLY runs — then YTD is whole
-- from the monthly runs alone and no opening balance is needed. The PCB reader
-- (payroll-calculator, "3. YTD") already sums prior monthly runs at
-- confirmed/paid, and both these runs are `paid`.
--
-- WHAT WAS ACTUALLY MISSING. Re-extracted both files and reconciled every line
-- against the database, sen by sen. Every line already present matches BrioHR
-- exactly. Only three lines were absent:
--
--   month  employee                          gross       pcb
--   Jan    CC054 Ariff Izham bin Abd Rahman  12,519.23  1,559.10
--   Feb    CC054 Ariff Izham bin Abd Rahman  10,500.00  1,054.15
--   Feb    CC061 Izzah Nusaibah binti Iszam   1,700.00      0.00
--
-- and the run-level shortfalls fall out to the sen: Jan gross was short
-- 12,519.23 (Ariff alone), Feb short 12,200.00 (10,500 + 1,700). Jan PCB was
-- short exactly 1,559.10; Feb exactly 1,054.15.
--
-- Ariff's 12,519.23 + 10,500.00 = 23,019.23 is the same figure already named in
-- the payroll-calculator comment as the size of his YTD hole. Restoring these
-- two lines lifts his YTD-through-June to 65,019.23 gross / 5,775.70 PCB paid
-- and puts July PCB back in the right bracket (it fell 1,064.60 -> 618.50 when
-- the opening balance was deleted).
--
-- CC048 Muhammad Asyraf appears in the Jan file with zeros throughout - no pay,
-- correctly absent, not inserted.
--
-- TWO JUDGEMENT CALLS, both flagged to the owner before applying:
--
-- 1. net_pay. Every one of the 40 existing 2026 monthly lines satisfies
--    net = gross - deductions with a zero gap. Ariff's BrioHR Net Pay does not:
--    it adds an expense-claim reimbursement (898.19 Jan, 158.00 Feb) that is not
--    payroll and is not taxable. These lines preserve the invariant - net_pay is
--    9,532.48 / 8,249.20 - and the claim is recorded in computation_details
--    rather than inflating net. Consequence: the run totals are payroll totals,
--    so Jan/Feb net will sit 898.19/158.00 below BrioHR's own net figure. That is
--    the intended difference, not a discrepancy.
--
-- 2. Izzah Nusaibah has no User row - she joined 01-02-2026 and left 15-03-2026,
--    before the system did. She is created the same way the other BrioHR imports
--    were: synthetic id (ASCII "briohr-CC061" as a UUID, matching the existing
--    convention) and status DEACTIVATED, so she never appears in staff lists.
--
-- SQL-managed tables (hr_* are not in schema.prisma). Apply manually via
-- Supabase SQL - hybrid workflow, docs/database-migrations.md.
-- NEVER prisma db push / migrate deploy.

BEGIN;

-- Izzah Nusaibah: leaver who predates the system. DEACTIVATED, no app access.
INSERT INTO "User" (id, name, "fullName", role, status, "bankName", "bankAccountNumber", "bankAccountName", "createdAt", "updatedAt")
VALUES (
  '6272696f-6872-2d43-4330-363100000000',
  'Izzah Nusaibah',
  'Izzah Nusaibah Binti Iszam',
  'STAFF',
  'DEACTIVATED',
  'Maybank Islamic Berhad',
  '562263678109',
  'Izzah Nusaibah Binti Iszam',
  now(), now()
)
ON CONFLICT (id) DO NOTHING;

-- Jan: Ariff Izham. Gross = 10,500 basic + 2,019.23 arrears of salary.
INSERT INTO hr_payroll_items (
  id, payroll_run_id, user_id, basic_salary,
  total_regular_hours, total_ot_hours, ot_1x_amount, ot_1_5x_amount, ot_2x_amount, ot_3x_amount,
  allowances, total_gross,
  epf_employee, socso_employee, eis_employee, pcb_tax,
  other_deductions, total_deductions, net_pay,
  epf_employer, socso_employer, eis_employer,
  computation_details, anomaly_flags
) VALUES (
  gen_random_uuid(), 'ad3f95af-44d4-5332-9867-33a3b8055393', '2b906d16-7842-439c-b64e-ec596b1912e5', 10500.00,
  0, 0, 0, 0, 0, 0,
  '{"Arrears Of Salary": {"amount": 2019.23}}'::jsonb, 12519.23,
  1386.00, 29.75, 11.90, 1559.10,
  '{}'::jsonb, 2986.75, 9532.48,
  1512.00, 104.15, 11.90,
  '{"source": "briohr_import_202601", "pcb_gross": 12519.23, "briohr_net_pay": 10430.67, "net_additions": {"Expense Claims": 898.19}, "note": "Expense claims are a reimbursement, excluded from gross and from net_pay to keep net = gross - deductions."}'::jsonb,
  '[]'::jsonb
);

-- Feb: Ariff Izham. Basic only, no arrears.
INSERT INTO hr_payroll_items (
  id, payroll_run_id, user_id, basic_salary,
  total_regular_hours, total_ot_hours, ot_1x_amount, ot_1_5x_amount, ot_2x_amount, ot_3x_amount,
  allowances, total_gross,
  epf_employee, socso_employee, eis_employee, pcb_tax,
  other_deductions, total_deductions, net_pay,
  epf_employer, socso_employer, eis_employer,
  computation_details, anomaly_flags
) VALUES (
  gen_random_uuid(), 'bbbcb9db-448f-5d94-b586-912288cdb859', '2b906d16-7842-439c-b64e-ec596b1912e5', 10500.00,
  0, 0, 0, 0, 0, 0,
  '{}'::jsonb, 10500.00,
  1155.00, 29.75, 11.90, 1054.15,
  '{}'::jsonb, 2250.80, 8249.20,
  1260.00, 104.15, 11.90,
  '{"source": "briohr_import_202602", "pcb_gross": 10500.00, "briohr_net_pay": 8407.20, "net_additions": {"Expense Claims": 158.00}, "note": "Expense claims are a reimbursement, excluded from gross and from net_pay to keep net = gross - deductions."}'::jsonb,
  '[]'::jsonb
);

-- Feb: Izzah Nusaibah. Full month at 1,700; no PCB.
INSERT INTO hr_payroll_items (
  id, payroll_run_id, user_id, basic_salary,
  total_regular_hours, total_ot_hours, ot_1x_amount, ot_1_5x_amount, ot_2x_amount, ot_3x_amount,
  allowances, total_gross,
  epf_employee, socso_employee, eis_employee, pcb_tax,
  other_deductions, total_deductions, net_pay,
  epf_employer, socso_employer, eis_employer,
  computation_details, anomaly_flags
) VALUES (
  gen_random_uuid(), 'bbbcb9db-448f-5d94-b586-912288cdb859', '6272696f-6872-2d43-4330-363100000000', 1700.00,
  0, 0, 0, 0, 0, 0,
  '{}'::jsonb, 1700.00,
  187.00, 8.25, 3.30, 0.00,
  '{}'::jsonb, 198.55, 1501.45,
  221.00, 28.85, 3.30,
  '{"source": "briohr_import_202602", "pcb_gross": 1700.00, "briohr_net_pay": 1501.45}'::jsonb,
  '[]'::jsonb
);

-- Re-total both runs FROM their lines, so the headers cannot drift from the
-- detail again. Deliberately derived, not hardcoded.
UPDATE hr_payroll_runs r SET
  total_gross         = t.gross,
  total_deductions    = t.deductions,
  total_net           = t.net,
  total_employer_cost = t.employer,
  updated_at          = now()
FROM (
  SELECT payroll_run_id,
         round(sum(total_gross), 2)                                            AS gross,
         round(sum(total_deductions), 2)                                       AS deductions,
         round(sum(net_pay), 2)                                                AS net,
         round(sum(epf_employer + socso_employer + eis_employer), 2)           AS employer
  FROM hr_payroll_items
  WHERE payroll_run_id IN ('ad3f95af-44d4-5332-9867-33a3b8055393', 'bbbcb9db-448f-5d94-b586-912288cdb859')
  GROUP BY payroll_run_id
) t
WHERE r.id = t.payroll_run_id;

COMMIT;

-- Expected after apply:
--   Jan  20 lines  gross 77,516.31  deductions 10,847.65  net 66,668.66  employer 9,958.50
--   Feb  23 lines  gross 67,671.00  deductions  9,350.05  net 58,320.95  employer 9,344.45
-- Gross matches BrioHR exactly in both months. Net sits 898.19 (Jan) / 158.00
-- (Feb) below BrioHR's, being the expense claims - see judgement call 1 above.
