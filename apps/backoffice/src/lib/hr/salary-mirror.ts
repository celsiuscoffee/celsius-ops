// Apply approved, now-due salary-history rows to the live profile columns.
//
// The salary-history API mirrors a row to the profile only when its
// effective_date is already in the past AT SAVE TIME. A raise logged ahead of
// its effective date ("RM2,200 from 1 Sept", entered 15 Aug) closed the prior
// row, showed as settled in the UI — and then never took effect, because no
// sweep existed and both payroll engines read the live profile columns. This
// is that sweep, run lazily at the top of every payroll compute (the moment
// the correct rate actually matters), so it needs no cron slot.
//
// Deliberately BOUNDED: only rows whose effective_date fell due within the
// last MIRROR_WINDOW_DAYS are considered. Prod carries pre-fix history rows
// (BrioHR-import artifacts, amounts of 0, years stale) that disagree with
// correct live profiles — an unbounded sweep would "apply" that junk and
// zero real salaries. Rows with amount <= 0 are skipped for the same reason.

import { hrSupabaseAdmin } from "./supabase";
import { getMYTToday } from "./constants";

const MIRROR_WINDOW_DAYS = 35;

const PROFILE_COLUMN: Record<string, string> = {
  monthly: "basic_salary",
  hourly: "hourly_rate",
  hourly_weekend: "hourly_rate_weekend",
};

/**
 * @param opts.effectiveBefore — exclusive YYYY-MM-DD cap on effective_date.
 *   A payroll run passes the day after its cycle end so a raise dated inside
 *   the NEXT period is not landed on the profile while THIS period is being
 *   priced: August is computed on 2 Sep, and a RM2,200 raise effective 1 Sep
 *   used to be mirrored first and paid for August (2026-09-03 QA).
 */
export async function applyDueSalaryMirrors(opts: { effectiveBefore?: string } = {}): Promise<string[]> {
  const today = getMYTToday();
  const windowStart = new Date(Date.parse(`${today}T00:00:00Z`) - MIRROR_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const cutoff = opts.effectiveBefore && opts.effectiveBefore < tomorrow ? opts.effectiveBefore : tomorrow;

  const { data: rows } = await hrSupabaseAdmin
    .from("hr_salary_history")
    .select("user_id, salary_type, amount, effective_date")
    .eq("status", "approved")
    .is("end_date", null)
    .gt("amount", 0)
    .lt("effective_date", cutoff)
    .gte("effective_date", windowStart);
  if (!rows || rows.length === 0) return [];

  // Newest row per (user, type) wins — an older open row never overrides a
  // newer one.
  const newest = new Map<string, { user_id: string; salary_type: string; amount: number; effective_date: string }>();
  for (const r of rows) {
    const key = `${r.user_id}|${r.salary_type}`;
    const cur = newest.get(key);
    if (!cur || r.effective_date > cur.effective_date) newest.set(key, r);
  }

  const userIds = Array.from(new Set([...newest.values()].map((r) => r.user_id)));
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, basic_salary, hourly_rate, hourly_rate_weekend")
    .in("user_id", userIds);
  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p as Record<string, unknown>]));

  const notes: string[] = [];
  for (const r of newest.values()) {
    const column = PROFILE_COLUMN[r.salary_type];
    const profile = profileMap.get(r.user_id);
    if (!column || !profile) continue;
    const live = profile[column] == null ? null : Number(profile[column]);
    const due = Number(r.amount);
    if (live === due) continue;
    const { error } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .update({ [column]: due, updated_at: new Date().toISOString() })
      .eq("user_id", r.user_id);
    if (error) {
      notes.push(`⚠ salary mirror FAILED for ${r.user_id.slice(0, 8)} (${r.salary_type} → RM${due}): ${error.message}`);
      continue;
    }
    notes.push(
      `Applied due salary change for ${r.user_id.slice(0, 8)}: ${r.salary_type} RM${live ?? "unset"} → RM${due} (effective ${r.effective_date}).`,
    );
  }
  return notes;
}
