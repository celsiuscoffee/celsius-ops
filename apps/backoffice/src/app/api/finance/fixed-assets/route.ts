// GET  /api/finance/fixed-assets: the register with computed columns
//      (monthly depreciation, accumulated to date, net book value).
// POST /api/finance/fixed-assets: create an asset. Manual entry, or pass
//      bankLineId to capitalize a classified EQUIPMENTS bank line: cost,
//      acquisition date, company and outlet prefill from the line and the
//      asset links source_bank_line_id so the line can never capitalize twice.
//
// Owner/Admin only, like every finance mutation.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";
import { companyFromAccountName } from "@/lib/finance/gl-posting-map";
import {
  accumulatedDepreciation,
  listFixedAssets,
  monthlyDepreciation,
  netBookValue,
  ymOfDate,
} from "@/lib/finance/fixed-assets";

export const dynamic = "force-dynamic";

async function guard(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error };
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // MYT

  const assets = await listFixedAssets(companyId);
  const outletIds = [...new Set(assets.map((a) => a.outletId).filter((v): v is string => !!v))];
  const outlets = outletIds.length
    ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } })
    : [];
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));

  return NextResponse.json({
    assets: assets.map((a) => {
      const accumulated = accumulatedDepreciation(a, today);
      return {
        ...a,
        outletName: a.outletId ? (outletName.get(a.outletId) ?? null) : null,
        monthlyDep: monthlyDepreciation(a, ymOfDate(today)),
        accumulated,
        nbv: netBookValue(a, today),
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (g.error) return g.error;

  let body: {
    bankLineId?: string;
    name?: string;
    companyId?: string;
    outletId?: string | null;
    accountCode?: string;
    cost?: number;
    residual?: number;
    acquiredDate?: string;
    usefulLifeMonths?: number;
    notes?: string | null;
  } = {};
  try { body = (await req.json()) ?? {}; } catch { /* fall through to validation */ }

  const client = getFinanceClient();

  // Capitalize from a classified bank line: the line supplies cost, date,
  // company (from the owning bank account) and outlet.
  let sourceBankLineId: string | null = null;
  if (body.bankLineId) {
    const line = await prisma.bankStatementLine.findUnique({
      where: { id: body.bankLineId },
      select: { id: true, amount: true, txnDate: true, description: true, direction: true, outletId: true, statement: { select: { accountName: true } } },
    });
    if (!line) return NextResponse.json({ error: "Bank line not found" }, { status: 404 });
    if (line.direction !== "DR") return NextResponse.json({ error: "Only outflow lines can be capitalized" }, { status: 400 });
    const { data: linked } = await client
      .from("fin_fixed_assets").select("id").eq("source_bank_line_id", line.id).limit(1);
    if (linked && linked.length) {
      return NextResponse.json({ error: "This bank line is already capitalized" }, { status: 409 });
    }
    sourceBankLineId = line.id;
    body.cost = body.cost ?? Number(line.amount);
    body.acquiredDate = body.acquiredDate ?? line.txnDate.toISOString().slice(0, 10);
    body.companyId = body.companyId ?? companyFromAccountName(line.statement.accountName);
    body.outletId = body.outletId ?? line.outletId;
    body.name = body.name || line.description;
  }

  const name = (body.name ?? "").trim();
  const cost = Number(body.cost);
  const residual = Number(body.residual ?? 0);
  const usefulLifeMonths = Number(body.usefulLifeMonths ?? 60);
  const accountCode = body.accountCode ?? "1500-02"; // Kitchen equipment default
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!body.companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  if (!Number.isFinite(cost) || cost <= 0) return NextResponse.json({ error: "cost must be > 0" }, { status: 400 });
  if (!Number.isFinite(residual) || residual < 0 || residual >= cost) {
    return NextResponse.json({ error: "residual must be >= 0 and below cost" }, { status: 400 });
  }
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
    return NextResponse.json({ error: "usefulLifeMonths must be a positive integer" }, { status: 400 });
  }
  if (!body.acquiredDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.acquiredDate)) {
    return NextResponse.json({ error: "acquiredDate must be YYYY-MM-DD" }, { status: 400 });
  }
  // account_code must be a 1500-xx PP&E account so the 1550-xx accumulated
  // depreciation counterpart derives cleanly.
  if (!/^1500-\d{2}$/.test(accountCode)) {
    return NextResponse.json({ error: "accountCode must be a 1500-xx PP&E account" }, { status: 400 });
  }
  const { data: acct } = await client.from("fin_accounts").select("code").eq("code", accountCode).maybeSingle();
  if (!acct) return NextResponse.json({ error: `Unknown account ${accountCode}` }, { status: 400 });

  await client.rpc("fin_set_actor", { p_actor: g.user.id }).then(() => undefined, () => undefined);
  const id = randomUUID();
  const { error } = await client.from("fin_fixed_assets").insert({
    id,
    company_id: body.companyId,
    outlet_id: body.outletId || null,
    description: name,
    account_code: accountCode,
    cost,
    residual,
    acquired_date: body.acquiredDate,
    useful_life_months: usefulLifeMonths,
    method: "straight_line",
    status: "active",
    source_bank_line_id: sourceBankLineId,
    notes: body.notes || null,
    created_by: g.user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id }, { status: 201 });
}
