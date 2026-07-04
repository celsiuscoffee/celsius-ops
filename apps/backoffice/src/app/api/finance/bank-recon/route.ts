// Bank reconciliation tick: assert per bank account per month that
// (opening balance + signed sum of the month's ledger lines) equals the
// statement closing balance, and let the owner sign it off.
//
// GET    -> per account, the last 12 months with opening / lines total /
//           computed close / statement close / delta / sign-off state.
// POST   { account, month }  -> sign off (Owner/Admin). Recomputes server
//           side and refuses with 409 unless the delta is zero (within 0.01).
// DELETE { account, month }  -> undo a sign-off (Owner/Admin), for corrections.
//
// Statement-to-month join: a statement "covers" a month when its period end
// (periodEnd, falling back to statementDate, which the Maybank parser sets to
// the statement end date) lands inside that month. Opening is the closing
// balance of the latest statement ending before the month.

import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getFinanceClient } from "@/lib/finance/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS_BACK = 12;
const TOLERANCE = 0.01;

const round2 = (n: number) => Math.round(n * 100) / 100;

type MonthRow = {
  month: string; // YYYY-MM-01
  opening: number | null;
  linesTotal: number;
  computedClose: number | null;
  statedClose: number | null;
  delta: number | null;
  unclassified: number;
  hasStatement: boolean;
  signedOffBy: string | null;
  signedOffAt: string | null;
};

type AccountRecon = { account: string; months: MonthRow[] };

async function guard(req: NextRequest): Promise<{ error: NextResponse | null; user: SessionUser | null }> {
  const auth = await requireAuth(req);
  if (auth.error) return { error: auth.error, user: null };
  if (!["OWNER", "ADMIN"].includes(auth.user.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), user: null };
  }
  return { error: null, user: auth.user };
}

// "2026-06" or "2026-06-15" -> "2026-06-01"; null if unparseable.
function normalizeMonth(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const m = input.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

function monthStartUTC(offsetBack: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offsetBack, 1));
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Compute the recon grid for every account with statements, newest month first.
async function computeRecon(): Promise<AccountRecon[]> {
  const windowStart = monthStartUTC(MONTHS_BACK - 1);
  const months: string[] = [];
  for (let i = 0; i < MONTHS_BACK; i++) months.push(ymd(monthStartUTC(i)));

  const statements = await prisma.bankStatement.findMany({
    select: { id: true, accountName: true, statementDate: true, closingBalance: true, periodEnd: true },
    orderBy: { statementDate: "asc" },
  });

  type Stmt = { id: string; effectiveEnd: Date; closing: number };
  const byAccount = new Map<string, Stmt[]>();
  const stmtToAccount = new Map<string, string>();
  for (const s of statements) {
    const account = s.accountName ?? "(no account)";
    const effectiveEnd = s.periodEnd ?? s.statementDate;
    const list = byAccount.get(account) ?? [];
    list.push({ id: s.id, effectiveEnd, closing: Number(s.closingBalance) });
    byAccount.set(account, list);
    stmtToAccount.set(s.id, account);
  }

  // Signed sums + unclassified counts per (account, month) over the window.
  const lines = await prisma.bankStatementLine.findMany({
    where: { txnDate: { gte: windowStart } },
    select: { statementId: true, txnDate: true, amount: true, direction: true, category: true },
  });
  const sums = new Map<string, { total: number; unclassified: number }>();
  for (const l of lines) {
    const account = stmtToAccount.get(l.statementId);
    if (!account) continue;
    const key = `${account}|${ymd(l.txnDate).slice(0, 7)}-01`;
    const agg = sums.get(key) ?? { total: 0, unclassified: 0 };
    agg.total += (l.direction === "CR" ? 1 : -1) * Number(l.amount);
    if (!l.category) agg.unclassified += 1;
    sums.set(key, agg);
  }

  // Sign-offs. Tolerate the table not existing yet (migration 071 pending).
  const signoffs = new Map<string, { by: string | null; at: string | null }>();
  try {
    const client = getFinanceClient();
    const { data, error } = await client
      .from("fin_bank_recons")
      .select("account, month, signed_off_by, signed_off_at")
      .gte("month", ymd(windowStart));
    if (!error && data) {
      for (const r of data) {
        signoffs.set(`${r.account}|${String(r.month).slice(0, 10)}`, {
          by: r.signed_off_by ?? null,
          at: r.signed_off_at ?? null,
        });
      }
    }
  } catch { /* sign-off info is optional; the grid still renders */ }

  const accounts: AccountRecon[] = [];
  for (const [account, stmts] of [...byAccount.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rows: MonthRow[] = months.map((month) => {
      const start = new Date(`${month}T00:00:00.000Z`);
      const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

      // Statement covering this month = the one with the latest period end inside it.
      let covering: Stmt | null = null;
      for (const s of stmts) {
        if (s.effectiveEnd >= start && s.effectiveEnd < next) {
          if (!covering || s.effectiveEnd > covering.effectiveEnd) covering = s;
        }
      }
      // Opening = closing balance of the latest statement ending before the month.
      let openingStmt: Stmt | null = null;
      for (const s of stmts) {
        if (s.effectiveEnd < start) {
          if (!openingStmt || s.effectiveEnd > openingStmt.effectiveEnd) openingStmt = s;
        }
      }

      const agg = sums.get(`${account}|${month}`);
      const linesTotal = round2(agg?.total ?? 0);
      const opening = openingStmt ? round2(openingStmt.closing) : null;
      const statedClose = covering ? round2(covering.closing) : null;
      const computedClose = opening == null ? null : round2(opening + linesTotal);
      const delta = computedClose == null || statedClose == null ? null : round2(computedClose - statedClose);
      const signoff = signoffs.get(`${account}|${month}`);

      return {
        month,
        opening,
        linesTotal,
        computedClose,
        statedClose,
        delta,
        unclassified: agg?.unclassified ?? 0,
        hasStatement: !!covering,
        signedOffBy: signoff?.by ?? null,
        signedOffAt: signoff?.at ?? null,
      };
    });
    accounts.push({ account, months: rows });
  }
  return accounts;
}

export async function GET(req: NextRequest) {
  const { error } = await guard(req);
  if (error) return error;
  const accounts = await computeRecon();
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const { error, user } = await guard(req);
  if (error || !user) return error;
  let body: { account?: string; month?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const month = normalizeMonth(body.month);
  if (!body.account || !month) {
    return NextResponse.json({ error: "account and month required" }, { status: 400 });
  }

  // Never trust the client's numbers: recompute server-side and only accept
  // a sign-off when the month actually reconciles.
  const accounts = await computeRecon();
  const row = accounts.find((a) => a.account === body.account)?.months.find((m) => m.month === month);
  if (!row) return NextResponse.json({ error: "Unknown account or month outside the 12-month window" }, { status: 404 });
  if (row.statedClose == null) {
    return NextResponse.json({ error: "No statement covers this month yet" }, { status: 409 });
  }
  if (row.delta == null || Math.abs(row.delta) > TOLERANCE) {
    return NextResponse.json(
      { error: `Delta is not zero (${row.delta ?? "unknown"}). Fix missing or duplicated lines, or the statement balance, before signing off.` },
      { status: 409 },
    );
  }

  const client = getFinanceClient();
  const { error: dbError } = await client.from("fin_bank_recons").upsert(
    {
      account: body.account,
      month,
      stated_close: row.statedClose,
      computed_close: row.computedClose,
      delta: row.delta,
      signed_off_by: user.name || user.id,
      signed_off_at: new Date().toISOString(),
    },
    { onConflict: "account,month" },
  );
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true, account: body.account, month, delta: row.delta });
}

export async function DELETE(req: NextRequest) {
  const { error, user } = await guard(req);
  if (error || !user) return error;
  let body: { account?: string; month?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const month = normalizeMonth(body.month);
  if (!body.account || !month) {
    return NextResponse.json({ error: "account and month required" }, { status: 400 });
  }
  const client = getFinanceClient();
  const { error: dbError } = await client
    .from("fin_bank_recons")
    .delete()
    .eq("account", body.account)
    .eq("month", month);
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
