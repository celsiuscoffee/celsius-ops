-- Extends ops audits to support staff-skills templates alongside the existing
-- outlet-scoped SOP/quality audits. Two new fields on AuditTemplate, one on
-- AuditReport.
--
-- Backwards-compat: every existing template defaults to auditTarget = 'OUTLET',
-- so all current SOP/quality audits and reports keep working unchanged.
-- jobRoleFilter and auditeeId stay NULL for those.
--
-- A STAFF-targeted template carries jobRoleFilter (matched against
-- hr_employee_profiles.position) so the manager's staff picker can be scoped
-- to people who actually hold that role at the outlet. The auditee themselves
-- is recorded on AuditReport.auditeeId, which is what powers the per-staff
-- improvement-over-time view (auditeeId + templateId + date trend).
ALTER TABLE "AuditTemplate"
  ADD COLUMN IF NOT EXISTS "auditTarget" TEXT NOT NULL DEFAULT 'OUTLET',
  ADD COLUMN IF NOT EXISTS "jobRoleFilter" TEXT;

CREATE INDEX IF NOT EXISTS "AuditTemplate_auditTarget_idx"
  ON "AuditTemplate" ("auditTarget");

ALTER TABLE "AuditReport"
  ADD COLUMN IF NOT EXISTS "auditeeId" TEXT;

-- FK to User. ON DELETE SET NULL so removing a staff record doesn't blow away
-- their historical audits — we still want the score history to exist for
-- aggregate reporting even if the person leaves.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AuditReport_auditeeId_fkey'
      AND table_name = 'AuditReport'
  ) THEN
    ALTER TABLE "AuditReport"
      ADD CONSTRAINT "AuditReport_auditeeId_fkey"
      FOREIGN KEY ("auditeeId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AuditReport_auditeeId_date_idx"
  ON "AuditReport" ("auditeeId", "date");
