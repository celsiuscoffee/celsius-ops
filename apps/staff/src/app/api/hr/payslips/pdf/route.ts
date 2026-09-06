import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createServiceToken, verifyServiceToken } from "@celsius/auth";
// Service-role client: hr_* tables are RLS deny-all. Every read is scoped to a
// single authorized user_id (session owner, or the item bound into a download
// token), so staff can only ever pull their OWN payslip PDF.
import { supabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/prisma";
import {
  generatePayslipPDF,
  mapPayslipData,
  computePayslipYtd,
} from "@celsius/shared/src/hr/payslip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A download token authorizes ONE payslip item. Scope carries the item id, so a
// token can never be replayed for a different payslip. Short TTL — it only has
// to survive the hop from "mint link" to "open in browser".
const DOWNLOAD_SCOPE = "hr.payslip.download";
const DOWNLOAD_TTL_SECONDS = 180;

// GET /api/hr/payslips/pdf?item_id=X
//   Three modes, all self-scoped:
//   • session + no token           → stream the caller's own payslip PDF (web).
//   • session + link=1             → JSON { url } with a short-lived token link
//                                     (native: fetch authed, then open the URL).
//   • token (no session needed)    → stream the payslip the token authorizes.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const itemId = url.searchParams.get("item_id");
    const token = url.searchParams.get("token");
    const wantLink = url.searchParams.get("link") === "1";
    if (!itemId) return NextResponse.json({ error: "item_id required" }, { status: 400 });

    // Resolve the ONE payroll item this request is authorized to render.
    let item: Record<string, unknown> | null = null;
    if (token) {
      // Token path — the scope binds the token to exactly this item, so the
      // item's own user_id is trusted (no session required: opened in a browser).
      const ok = await verifyServiceToken(token, `${DOWNLOAD_SCOPE}:${itemId}`);
      if (!ok) return NextResponse.json({ error: "Invalid or expired link" }, { status: 403 });
      const { data } = await supabaseAdmin.from("hr_payroll_items").select("*").eq("id", itemId).maybeSingle();
      item = data;
    } else {
      // Session path — scope the item to the caller (a mismatched user_id just
      // returns no row, so no one can fetch another employee's slip).
      const session = await getSession();
      if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const { data } = await supabaseAdmin
        .from("hr_payroll_items")
        .select("*")
        .eq("id", itemId)
        .eq("user_id", session.id)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: "Payslip not found" }, { status: 404 });
      if (wantLink) {
        // Mint a short-lived, item-bound link the native app can open in a
        // browser (which can't carry the Bearer token).
        const linkToken = await createServiceToken(`${DOWNLOAD_SCOPE}:${itemId}`, DOWNLOAD_TTL_SECONDS);
        return NextResponse.json({
          url: `${url.origin}/api/hr/payslips/pdf?item_id=${encodeURIComponent(itemId)}&token=${encodeURIComponent(linkToken)}`,
        });
      }
      item = data;
    }
    if (!item) return NextResponse.json({ error: "Payslip not found" }, { status: 404 });

    const uid = item.user_id as string;

    const { data: run } = await supabaseAdmin
      .from("hr_payroll_runs")
      .select("*")
      .eq("id", item.payroll_run_id as string)
      .single();
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    // Staff only ever see confirmed/paid slips (mirrors /api/hr/payslips and the
    // admin route's gate) — never a provisional mid-month computation.
    if (!["confirmed", "paid"].includes(run.status) || run.cycle_type === "opening_balance") {
      return NextResponse.json(
        { error: "This payslip isn't available yet — ask HR once payroll is confirmed." },
        { status: 409 },
      );
    }

    // Weekly (part-timer) runs have no period_month/year — derive them from
    // the week start so the banner, YTD header and filename are real values
    // (they printed "undefined null" / PAYSLIP_X_nullnull.pdf).
    const periodYear: number = run.period_year ?? Number(String(run.period_start ?? "").slice(0, 4));
    const periodMonth: number = run.period_month ?? Number(String(run.period_start ?? "").slice(5, 7));
    const periodTag = run.period_month
      ? `${periodYear}${String(periodMonth).padStart(2, "0")}`
      : `WEEK_${String(run.period_start ?? "").replace(/-/g, "")}`;

    const [ytdByUser, profileRes, companyRes, user] = await Promise.all([
      computePayslipYtd(supabaseAdmin, {
        periodYear,
        periodMonth,
        userIds: [uid],
        currentItems: [item],
      }),
      supabaseAdmin
        .from("hr_employee_profiles")
        .select("user_id, ic_number, position, epf_number, socso_number, tax_number")
        .eq("user_id", uid)
        .maybeSingle(),
      supabaseAdmin.from("hr_company_settings").select("*").limit(1).maybeSingle(),
      prisma.user.findUnique({
        where: { id: uid },
        select: { name: true, fullName: true, bankName: true, bankAccountNumber: true, outlet: { select: { name: true } } },
      }),
    ]);

    const record = mapPayslipData(item, {
      run,
      user: user
        ? {
            name: user.name,
            fullName: user.fullName,
            bankName: user.bankName,
            bankAccountNumber: user.bankAccountNumber,
            outletName: user.outlet?.name ?? null,
          }
        : undefined,
      profile: profileRes.data ?? undefined,
      company: companyRes.data,
      ytd: ytdByUser.get(uid),
    });

    const pdfBytes = await generatePayslipPDF(record);
    const filename = `PAYSLIP_${record.employeeName.replace(/\s+/g, "_")}_${periodTag}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF generation failed";
    console.error("[staff payslip pdf] error:", err instanceof Error ? err.stack : message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
