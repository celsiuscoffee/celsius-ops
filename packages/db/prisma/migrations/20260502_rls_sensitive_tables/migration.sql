-- Enable RLS on sensitive tables — defense in depth for the
-- "service-role bypass" risk flagged in docs/rls-strategy.md.
--
-- Policy: enable RLS but write NO permissive policies. Net effect:
--   - service-role connections (Prisma + supabaseAdmin clients):
--     bypass RLS unconditionally. App keeps working unchanged.
--   - anon-key connections: deny-all by default. If anyone ever
--     points the public anon key at these tables by mistake (or
--     a service-role key leaks but is downgraded), they get
--     nothing — not the full table dump.
--
-- Coverage: 27 tables across financial, HR/payroll PII, and ads
-- domains. The 24 remaining no-RLS tables are config/catalog
-- (hr_stat_*, hr_company_settings, AppConfig, etc.) — non-sensitive,
-- stay open for now.
--
-- Applied via Supabase MCP on 2026-05-02. Brought RLS coverage
-- from 90/141 (64%) to 117/141 (83%).

ALTER TABLE "BankStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatementLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrClaimBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_salary_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_family ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_child_relief ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_recurring_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employee_tax_reliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_overtime_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_attendance_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_payroll_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_review_penalty ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_job_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_payment ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_metric_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_keyword_metric ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_conversion_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_insights_cache ENABLE ROW LEVEL SECURITY;
