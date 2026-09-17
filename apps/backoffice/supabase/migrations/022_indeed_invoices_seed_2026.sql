-- NOT YET APPLIED to production. Apply with owner approval, AFTER
-- 021_indeed_invoice_items_and_claims.sql.
--
-- Loads the four Indeed invoices supplied by the owner (itemized CSV exports
-- from employers.indeed.com), with their line items and reimbursement status.
--
-- FX is the implied rate from the actual reimbursement, not a reference rate:
--   SGI26-00141171  RM1,903.66 / USD 454.29 = 4.190385
--   SGI26-00182946  RM2,262.26 / USD 540.26 = 4.187419
-- The two unreimbursed invoices carry no amount_myr — they convert when paid.
--
-- SGI26-00182946 is 61.5% Gosame International Sdn Bhd, a different company
-- billed to the Celsius Indeed account. Its items are flagged is_celsius=false
-- so the recruitment view can separate recoverable spend from Celsius cost.

insert into indeed_ads_invoice
  (id, invoice_number, issue_date, period_start, period_end, amount_usd, amount_myr,
   status, notes, claimed_at, reimbursed_at, bank_line_id, fx_rate) values
  ('indeed-SGI26-00128154','SGI26-00128154','2026-05-31','2026-05-01','2026-05-31',261.77,null,
   'unpaid','Itemized CSV. Not found in the bank ledger — still in the claim pipeline.',null,null,null,null),
  ('indeed-SGI26-00141171','SGI26-00141171','2026-06-30','2026-06-01','2026-06-30',454.29,1903.66,
   'paid','Reimbursed 2026-08-24, narrated "indeed 2/7/26" — 55 days after issue.',
   null,'2026-08-24T00:00:00Z','6fc0738c-6f03-45ba-a1f5-6f9e5f09cc60',4.190385),
  ('indeed-SGI26-00178265','SGI26-00178265','2026-07-31','2026-07-01','2026-07-31',253.89,null,
   'unpaid','Itemized CSV. Not found in the bank ledger — still in the claim pipeline.',null,null,null,null),
  ('indeed-SGI26-00182946','SGI26-00182946','2026-08-13','2026-08-01','2026-08-13',540.26,2262.26,
   'paid','Reimbursed 2026-08-24, narrated "indeed 15/8/26". 61.5% is Gosame International Sdn Bhd.',
   null,'2026-08-24T00:00:00Z','a015fb72-c4b7-4e20-888c-44f9d1c813a5',4.187419)
on conflict (id) do nothing;

insert into indeed_ads_invoice_item
  (id, invoice_id, company_name, is_celsius, job_key, reference_number, job_title, location,
   quantity, unit, average_cost, amount_usd) values
  -- SGI26-00128154 (May 2026) — USD 242.38 net
  ('ii-128154-1','indeed-SGI26-00128154','Celsius Coffee Sdn. Bhd.',true,'6ffb6f3b257a93b1','03bdddbf-ea3e-49c2-bd96-fe960f8e676c','Barista','Nilai',1006,'click',0.17,168.16),
  ('ii-128154-2','indeed-SGI26-00128154','Celsius Coffee Sdn. Bhd.',true,'a465f4409b71add3','81c319fb-579e-4b69-8cbf-3d68a1c436cb','Kitchen Crew','Putrajaya',254,'click',0.29,74.22),
  -- SGI26-00141171 (Jun 2026) — USD 420.64 net
  ('ii-141171-1','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'2be200e41989a6dd','e83dadf2-c45d-4ffd-8326-f46014df5b72','Kitchen Crew','Cyberjaya',134,'click',0.48,64.17),
  ('ii-141171-2','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'837067cb871d691a','b89c50ce-3131-4995-823f-12c14079abf9','Barista','Cyberjaya',112,'click',0.36,40.05),
  ('ii-141171-3','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'ed6c1138f37ccedc','8ca0ce9f-d815-49d3-a925-e7367f21a658','Kitchen Crew','Shah Alam',88,'click',0.47,41.27),
  ('ii-141171-4','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'7b88ce253ca3be16','9fd556e8-bfc0-4cb4-bdb6-12397fa02d31','Barista','Putrajaya',153,'click',0.44,66.58),
  ('ii-141171-5','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'e4afef067b5a0b75','a7d61971-6cf2-4ffa-8922-dda6461d0aa7','Kitchen Crew','Putrajaya',130,'click',0.48,61.95),
  ('ii-141171-6','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'8604cab3dd6a07ba','8ac9b0d1-c21c-46c7-a608-6349a0fb9751','Barista','Putrajaya',117,'click',0.34,39.73),
  ('ii-141171-7','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'6ac8131bfb8b16c9','1c8c7bf6-5a02-4476-9577-dc0701edac58','Barista','Cyberjaya',256,'click',0.26,65.74),
  ('ii-141171-8','indeed-SGI26-00141171','Celsius Coffee Sdn. Bhd.',true,'d5d25c306ca3fc56','04edf892-c8c0-450f-99ec-6c6bf2ed3b41','Kitchen Crew','Cyberjaya',58,'click',0.71,41.15),
  -- SGI26-00178265 (Jul 2026) — USD 235.08 net
  ('ii-178265-1','indeed-SGI26-00178265','Celsius Coffee Sdn. Bhd.',true,'d0efb5f750961e0b','1b9dbe72-702b-4067-bfc4-2074a2ad10ac','Kitchen Crew','Shah Alam',181,'click',0.36,64.97),
  ('ii-178265-2','indeed-SGI26-00178265','Celsius Coffee Sdn. Bhd.',true,'837067cb871d691a','b89c50ce-3131-4995-823f-12c14079abf9','Barista','Cyberjaya',106,'click',0.16,17.26),
  ('ii-178265-3','indeed-SGI26-00178265','Celsius Coffee Sdn. Bhd.',true,'ed6c1138f37ccedc','8ca0ce9f-d815-49d3-a925-e7367f21a658','Kitchen Crew','Shah Alam',128,'click',0.26,33.73),
  ('ii-178265-4','indeed-SGI26-00178265','Celsius Coffee Sdn. Bhd.',true,'8604cab3dd6a07ba','8ac9b0d1-c21c-46c7-a608-6349a0fb9751','Barista','Putrajaya',222,'click',0.16,35.27),
  ('ii-178265-5','indeed-SGI26-00178265','Celsius Coffee Sdn. Bhd.',true,'d5d25c306ca3fc56','04edf892-c8c0-450f-99ec-6c6bf2ed3b41','Kitchen Crew','Cyberjaya',114,'click',0.30,33.85),
  ('ii-178265-6','indeed-SGI26-00178265','Celsius Coffee Sdn. Bhd.',true,'d70423e94de24eb8','6d114750-cbab-4145-bc1f-71ccfb010b3c','Barista','Shah Alam',188,'click',0.27,50.00),
  -- SGI26-00182946 (Aug 2026) — USD 500.24 net; Celsius 192.41, Gosame 307.83
  ('ii-182946-1','indeed-SGI26-00182946','Celsius Coffee Sdn. Bhd.',true,'d0efb5f750961e0b','1b9dbe72-702b-4067-bfc4-2074a2ad10ac','Kitchen Crew','Shah Alam',34,'click',0.13,4.54),
  ('ii-182946-2','indeed-SGI26-00182946','Celsius Coffee Sdn. Bhd.',true,'8643d5d0e2a4ab62','67b60c63-981d-4c6e-b611-467c97da3acd','Outlet Manager','Shah Alam',411,'click',0.29,119.79),
  ('ii-182946-3','indeed-SGI26-00182946','Celsius Coffee Sdn. Bhd.',true,'d70423e94de24eb8','6d114750-cbab-4145-bc1f-71ccfb010b3c','Barista','Shah Alam',492,'click',0.14,68.08),
  ('ii-182946-4','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'2a6da3e940da0cbe','c2a84022-3a23-4b6c-95a5-cf2a850d7ad2','Serving / Plating Crew','Kuala Lumpur',121,'click',0.28,33.58),
  ('ii-182946-5','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'8b74bedaf0b1475f','3f97f6da-f0d4-4bcc-acf6-c4823ec65670','Hot Kitchen Cook','Kuala Lumpur',96,'click',0.49,47.04),
  ('ii-182946-6','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'95c4330ab2b2eac7','f04bc332-4f31-4bdd-bbaa-609deeea038a','Grill Lead','Kuala Lumpur',61,'click',0.64,39.07),
  ('ii-182946-7','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'9c62967aa966cd50','2a76f345-ebcb-4607-879a-09c7b526c03a','Floor Manager','Kuala Lumpur',131,'click',0.41,53.46),
  ('ii-182946-8','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'c6f5c882b9f51344','29038955-28fc-47ff-939f-0b4619d88097','Wok Cook','Kuala Lumpur',109,'click',0.33,36.06),
  ('ii-182946-9','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'c11c98512fe6b51a','f4fd96f8-974a-43ab-a3f0-a96d84eb0ae2','Waiter / Service Crew','Kuala Lumpur',84,'click',0.60,50.16),
  ('ii-182946-10','indeed-SGI26-00182946','Gosame International Sdn Bhd',false,'1e4810c07c83573e','efad520c-d922-44c6-bf53-d19ada5e99e8','Beverage Crew','Kuala Lumpur',42,'click',1.15,48.46)
on conflict (id) do nothing;
