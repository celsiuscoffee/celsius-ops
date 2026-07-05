export const meta = {
  name: 'rls-audit',
  description: 'Audit sensitive tables for RLS coverage against docs/rls-strategy.md, verify findings, produce a prioritized report',
  whenToUse: 'When asked to audit database security/RLS coverage, or before starting Path A of the RLS strategy',
  phases: [
    { title: 'Audit', detail: 'one agent per table group — RLS state + access paths' },
    { title: 'Verify', detail: 'adversarial re-check of every "covered" or "critical" claim' },
    { title: 'Synthesize', detail: 'single prioritized report' },
  ],
}

// Priority groups from docs/rls-strategy.md ("Path A scoping"), highest
// sensitivity first. Override with: args = { groups: [ ... ] }
const DEFAULT_GROUPS = [
  { name: 'customer-pii', tables: ['members', 'member_brands', 'transactions', 'redemptions'] },
  { name: 'customer-activity', tables: ['push_subscriptions', 'points_history'] },
  { name: 'employee-pii', tables: ['attendance', 'payroll_runs'] },
  { name: 'internal-qa', tables: ['audits', 'audit_reports', 'checklists'] },
  { name: 'financial', tables: ['bank_statements', 'bank_statement_lines'] },
  { name: 'finance-module', tables: ['fin_transactions', 'fin_journal_lines', 'fin_invoices', 'fin_bills', 'fin_audit_log'] },
]

const groups = (args && args.groups) || DEFAULT_GROUPS

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          rls_enabled: { type: 'boolean' },
          policies_found: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string', description: 'file:line references for every claim' },
          access_paths: { type: 'string', description: 'which apps/routes query this table and with which key' },
          severity: { enum: ['critical', 'high', 'medium', 'low', 'covered'] },
          recommendation: { type: 'string' },
        },
        required: ['table', 'rls_enabled', 'evidence', 'severity', 'recommendation'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    confirmed: { type: 'boolean' },
    corrected_severity: { enum: ['critical', 'high', 'medium', 'low', 'covered'] },
    reason: { type: 'string' },
  },
  required: ['confirmed', 'reason'],
}

const results = await pipeline(
  groups,
  g =>
    agent(
      `Audit Row-Level Security for these Postgres tables in the celsius-ops repo: ${g.tables.join(', ')}.
Context: docs/rls-strategy.md says only "orders" and "order_items" have RLS enabled today and everything else is reached via the service-role key (bypasses RLS). Verify whether that is still true for each table:
1. Grep supabase/migrations/ and packages/db/prisma/migrations/ for ENABLE ROW LEVEL SECURITY / CREATE POLICY statements touching each table (a table may also not exist yet — say so).
2. Find the access paths: grep apps/ and packages/ for queries against each table (Prisma model name or raw SQL) and note whether they run server-side with the service-role key or client-side with the anon key.
3. Rate severity per table: "covered" (RLS on with sane policies), or critical/high/medium/low exposure based on data sensitivity (${g.name}) and reachability.
Cite file:line evidence for every claim. Return via StructuredOutput.`,
      { label: `audit:${g.name}`, phase: 'Audit', schema: FINDING_SCHEMA }
    ),
  (audit, g) =>
    parallel(
      (audit?.findings || [])
        .filter(f => f.severity === 'covered' || f.severity === 'critical')
        .map(f => () =>
          agent(
            `Adversarially verify this RLS audit finding for table "${f.table}" in celsius-ops. Claim: rls_enabled=${f.rls_enabled}, severity=${f.severity}. Evidence given: ${f.evidence}. Re-check the cited files yourself; for "covered" claims also check the policies aren't trivially bypassable (e.g. USING (true)) and that no later migration dropped them. Return confirmed=true/false with a corrected_severity if the rating is wrong.`,
            { label: `verify:${f.table}`, phase: 'Verify', schema: VERDICT_SCHEMA }
          ).then(v => ({ ...f, verdict: v }))
        )
    ).then(verified => {
      const byTable = new Map(verified.filter(Boolean).map(f => [f.table, f]))
      return {
        group: g.name,
        findings: (audit?.findings || []).map(f => byTable.get(f.table) || f),
      }
    })
)

phase('Synthesize')
const flat = results.filter(Boolean)
const report = await agent(
  `Combine these RLS audit findings into a single markdown report ordered by severity (critical first). For each table: current state, evidence, and the concrete next step. Where a verifier disagreed with the auditor, use the verifier's corrected severity and note the disagreement. End with a short "Path B quick wins" section (IP allowlist, key rotation — see docs/rls-strategy.md) if any critical findings exist. Findings JSON:\n${JSON.stringify(flat, null, 2)}`,
  { label: 'report', phase: 'Synthesize' }
)

return { report, findings: flat }
