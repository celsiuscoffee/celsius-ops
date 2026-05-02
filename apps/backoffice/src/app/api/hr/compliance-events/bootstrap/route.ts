import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";

export const dynamic = "force-dynamic";

// One-shot bootstrap of the standard Malaysian statutory calendar.
// Seeds the next 12 months of monthly filings + the next annual deadlines.
// Idempotent — skips any (category, due_date) row that already exists.
export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date();
  const events: Array<{
    category: string; title: string; due_date: string;
    recurrence: string; reminder_days: number; notes: string | null;
  }> = [];

  // Monthly statutory filings — KWSP/PERKESO/CP39/HRDF all due on 15th of the
  // month FOLLOWING the wage month. Seed the next 12 months.
  for (let i = 0; i < 12; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() + i + 1, 15);
    const due = m.toISOString().slice(0, 10);
    const wageMonth = new Date(today.getFullYear(), today.getMonth() + i, 1)
      .toLocaleDateString("en-MY", { month: "short", year: "numeric" });
    events.push(
      { category: "kwsp_form_a", title: `KWSP Form A — ${wageMonth} wages`, due_date: due, recurrence: "monthly", reminder_days: 7, notes: "Submit + pay employer + employee EPF contributions." },
      { category: "perkeso_form", title: `PERKESO contribution — ${wageMonth} wages`, due_date: due, recurrence: "monthly", reminder_days: 7, notes: "SOCSO + EIS submission via ASSIST portal." },
      { category: "lhdn_cp39_pcb", title: `LHDN CP39 (PCB) — ${wageMonth} wages`, due_date: due, recurrence: "monthly", reminder_days: 7, notes: "Monthly tax deduction submission via e-PCB." },
      { category: "hrdf", title: `HRDF levy — ${wageMonth} wages`, due_date: due, recurrence: "monthly", reminder_days: 7, notes: "1% of wages payable to HRDF Corp via e-LATiH." },
    );
  }

  // Annual filings — LHDN Form E (employer) + CP8D (statement of remuneration)
  // both due 31 March. Seed the next two years so we don't have to re-bootstrap mid-year.
  for (let yr = today.getFullYear(); yr <= today.getFullYear() + 1; yr++) {
    const due = `${yr}-03-31`;
    if (due >= today.toISOString().slice(0, 10) || yr > today.getFullYear()) {
      events.push(
        { category: "lhdn_form_e", title: `LHDN Form E — ${yr - 1} reporting`, due_date: due, recurrence: "annual", reminder_days: 30, notes: "Annual employer declaration. Form E covers the previous calendar year." },
        { category: "lhdn_cp8d", title: `LHDN CP8D — ${yr - 1} statement of remuneration`, due_date: due, recurrence: "annual", reminder_days: 30, notes: "CP8D companion to Form E — per-employee earnings summary." },
      );
    }
  }

  // Don't duplicate: fetch existing (category, due_date) and skip them.
  const { data: existing } = await hrSupabaseAdmin
    .from("hr_compliance_events")
    .select("category, due_date");
  const existingKeys = new Set(
    (existing || []).map((e: { category: string; due_date: string }) => `${e.category}|${e.due_date}`),
  );
  const fresh = events.filter((e) => !existingKeys.has(`${e.category}|${e.due_date}`));

  if (fresh.length === 0) {
    return NextResponse.json({ inserted: 0, message: "Calendar already seeded — nothing to add." });
  }

  const rows = fresh.map((e) => ({ ...e, status: "pending", created_by: session.id }));
  const { error } = await hrSupabaseAdmin.from("hr_compliance_events").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: rows.length, message: `Seeded ${rows.length} standard MY statutory events.` });
}
