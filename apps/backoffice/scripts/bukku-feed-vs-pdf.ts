// Diagnose the parity failure: is the raw feed COMPLETE? Compare the feed's
// monthly net (ΣCR−ΣDR) against the Maybank PDF ground truth for the same
// account+month. The PDF carries Maybank's own running balance, so its
// closing-balance delta per month is authoritative.
//
//   pnpm tsx --env-file=.env.local scripts/bukku-feed-vs-pdf.ts [CODE] [acctTail]

import { prisma } from "@celsius/db";
import { listBankFeeds, listBankAccounts, fetchRawFeedLines, mapRawFeedToLines, type BukkuCreds } from "../src/lib/finance/bukku-bank";

const fmt = (n: number) => (n >= 0 ? "+" : "") + n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const code = process.argv[2] ?? "CC001";
  const tail = process.argv[3] ?? "2644";
  const o = await prisma.outlet.findFirst({ where: { code }, select: { name: true, bukkuToken: true, bukkuSubdomain: true } });
  if (!o?.bukkuToken) throw new Error("no creds");
  const creds: BukkuCreds = { token: o.bukkuToken, subdomain: o.bukkuSubdomain! };
  console.log(`\n=== ${o.name} — feed vs PDF (acct …${tail}) ===`);

  // PDF ground truth: monthly closing balances + line sums.
  const stmts = await prisma.bankStatement.findMany({
    where: { accountName: { contains: tail } },
    select: { periodStart: true, periodEnd: true, closingBalance: true,
      lines: { select: { direction: true, amount: true } } },
    orderBy: { periodStart: "asc" },
  });
  const pdfByMonth = new Map<string, { net: number; cr: number; dr: number; n: number; closing: number }>();
  for (const s of stmts) {
    if (!s.periodEnd) continue;
    const m = s.periodEnd.toISOString().slice(0, 7);
    let cr = 0, dr = 0;
    for (const l of s.lines) { const a = Number(l.amount); if (l.direction === "CR") cr += a; else dr += a; }
    pdfByMonth.set(m, { net: cr - dr, cr, dr, n: s.lines.length, closing: Number(s.closingBalance) });
  }

  // Feed: monthly net.
  const feeds = await listBankFeeds(creds);
  const feed = feeds.find((f) => f.is_linked) ?? feeds[0];
  const fa = feed.accounts[0];
  const lines = mapRawFeedToLines(await fetchRawFeedLines(creds, feed.id, fa.linked_account_id));
  const feedByMonth = new Map<string, { net: number; cr: number; dr: number; n: number }>();
  for (const l of lines) {
    const m = l.txnDate.slice(0, 7);
    const cur = feedByMonth.get(m) ?? { net: 0, cr: 0, dr: 0, n: 0 };
    if (l.direction === "CR") { cur.cr += l.amount; cur.net += l.amount; } else { cur.dr += l.amount; cur.net -= l.amount; }
    cur.n += 1;
    feedByMonth.set(m, cur);
  }

  // Align on PDF months (the overlap we can verify).
  const months = [...pdfByMonth.keys()].sort();
  console.log(`\nmonth     | PDF net (n)         | PDF close-Δ   | feed net (n)        | net diff`);
  console.log("-".repeat(92));
  let prevClose: number | null = null;
  for (const m of months) {
    const p = pdfByMonth.get(m)!;
    const f = feedByMonth.get(m);
    const closeDelta = prevClose == null ? null : p.closing - prevClose;
    prevClose = p.closing;
    const diff = f ? f.net - p.net : null;
    console.log(
      `${m}  | ${fmt(p.net).padStart(13)} (${String(p.n).padStart(4)}) | ${(closeDelta == null ? "—" : fmt(closeDelta)).padStart(12)} | ${(f ? `${fmt(f.net)} (${String(f.n).padStart(4)})` : "no feed").padStart(18)} | ${diff == null ? "—" : fmt(diff)}`,
    );
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERR:", e.message); process.exit(1); });
