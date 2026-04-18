import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/hr/payroll/weekly/bank-file?run_id=...&format=csv
// Generates a bulk-transfer CSV for Maybank / CIMB upload. One row per payee.
// Grouped with a summary at top and per-staff lines.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get("run_id");
  if (!runId) return NextResponse.json({ error: "run_id required" }, { status: 400 });

  const { data: run } = await hrSupabaseAdmin
    .from("hr_payroll_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const { data: items } = await hrSupabaseAdmin
    .from("hr_payroll_items")
    .select("user_id, total_gross, net_pay")
    .eq("payroll_run_id", runId);

  const userIds = Array.from(new Set((items || []).map((i: { user_id: string }) => i.user_id)));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, fullName: true, bankName: true, bankAccountNumber: true, bankAccountName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // Simple generic CSV — one row per payee. Format is plain enough for
  // both Maybank M2U Biz and CIMB BizChannel bulk upload (they accept
  // Name, Account, Bank, Amount). Adjust column headers if needed.
  const lines: string[] = [];
  lines.push("Employee Name,Bank Name,Account Number,Account Holder,Amount,Reference");

  let totalPaid = 0;
  let skipped = 0;

  for (const item of items || []) {
    const u = userMap.get(item.user_id);
    if (!u || !u.bankAccountNumber || !u.bankName) {
      skipped++;
      continue;
    }
    const amount = Number(item.net_pay || 0);
    if (amount <= 0) continue;
    totalPaid += amount;
    const ref = `PT${run.period_start || ""}`.replace(/[^A-Z0-9]/gi, "").slice(0, 20);
    lines.push([
      `"${u.fullName || u.name}"`,
      `"${u.bankName}"`,
      u.bankAccountNumber,
      `"${u.bankAccountName || u.fullName || u.name}"`,
      amount.toFixed(2),
      ref,
    ].join(","));
  }

  lines.push("");
  lines.push(`Summary,,,,Total: RM ${totalPaid.toFixed(2)}, ${skipped} skipped (no bank)`);

  const csv = lines.join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="bank-transfer-${run.period_start || runId}.csv"`,
    },
  });
}
