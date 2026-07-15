// Cash-in reconciliation, per entity per channel.
//
// Ties revenue rung up to cash that actually landed in the bank, one row per
// (company, channel). Because Tamarind/Conezion card, QR and Revenue Monster
// all settle into the entity's own Maybank account, the bank statement IS the
// settlement, so no external report is needed to reconcile, only to explain the
// exact fee. The gap (revenue − banked) should be ~ the channel's fee/commission
// plus settlement timing; anything beyond that is flagged for review (money rung
// up that did not arrive).
//
// Revenue sources by channel:
//   card / qr  : in-store till tender (pos_order_payments; outlets are cashless)
//   online     : pickup app orders (RM gateway), settle as REVENUE_MONSTER
//   grab       : GrabFood gross (unified), settles net of commission + ads
//   consignment: GastroHub advices (consignment_sales), settle net of commission
// Cash is intentionally omitted, the tills are effectively cashless (~RM0).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Entity ↔ Maybank account suffix (BankStatement.accountName carries "(4384)").
const ACCOUNT_SUFFIX: Record<string, string> = {
  celsius: "4384",
  celsiusconezion: "2644",
  celsiustamarind: "9345",
};

// Expected deduction per channel (fee/commission), used only to judge whether
// the gap is explained. Not a posting.
const EXPECTED_PCT: Record<string, number> = {
  card: 1.0,        // Maybank / NTT MDR
  qr: 0.25,         // DuitNow
  online: 1.5,      // Revenue Monster gateway
  grab: 45,         // 33% commission + SST + ~12% GrabAds (both netted at settlement)
  consignment: 30,  // GastroHub commission
};
// Allowance above the expected fee for settlement timing before we flag.
const TIMING_BUFFER_PCT = 8;

export type CashInChannel = {
  company: string;
  channel: "card" | "qr" | "online" | "grab" | "consignment";
  revenue: number;       // gross rung up
  banked: number;        // cash-in to the bank
  gap: number;           // revenue − banked (fee + timing + anything unexplained)
  gapPct: number | null;
  expectedPct: number;
  status: "ok" | "review";
  note: string;
};

export type CashInReconResult = {
  from: string;
  to: string;
  rows: CashInChannel[];
  totals: { revenue: number; banked: number; gap: number };
};

export async function cashInReconByChannel(from: string, to: string): Promise<CashInReconResult> {
  const start = new Date(`${from}T00:00:00+08:00`);
  const end = new Date(`${to}T23:59:59+08:00`);

  // ── Revenue: in-store card/qr tender per company (till is in sen) ──
  // NOTE: pos_orders.outlet_id is the LOYALTY outlet id ("outlet-con"), not the
  // Outlet UUID, so it must map through Outlet.loyaltyOutletId to reach the
  // company. (orders.store_id below maps through Outlet.pickupStoreId.)
  const tender = await prisma.$queryRaw<{ company_id: string; method: string; rm: number }[]>(Prisma.sql`
    SELECT fc.company_id, p.payment_method AS method, COALESCE(SUM(p.amount),0)::float/100 AS rm
    FROM pos_order_payments p
    JOIN pos_orders o ON o.id = p.order_id
    JOIN "Outlet" ou ON ou."loyaltyOutletId" = o.outlet_id
    JOIN fin_outlet_companies fc ON fc.outlet_id = ou.id
    WHERE o.status='completed' AND p.status='completed'
      AND p.payment_method IN ('card','qr')
      AND o.created_at >= ${start} AND o.created_at <= ${end}
    GROUP BY 1,2
  `);

  // ── Revenue: online (pickup app, RM gateway) per company ──
  const online = await prisma.$queryRaw<{ company_id: string; rm: number }[]>(Prisma.sql`
    SELECT fc.company_id, COALESCE(SUM(ord.total),0)::float/100 AS rm
    FROM orders ord
    JOIN "Outlet" ou ON ou."pickupStoreId" = ord.store_id
    JOIN fin_outlet_companies fc ON fc.outlet_id = ou.id
    WHERE ord.status='completed'
      AND ord.created_at >= ${start} AND ord.created_at <= ${end}
    GROUP BY 1
  `);

  // ── Revenue: Grab gross + consignment gross per company ──
  const grabGross = await prisma.$queryRaw<{ company_id: string; rm: number }[]>(Prisma.sql`
    SELECT fc.company_id, COALESCE(SUM(oi.item_total),0)::float/100 AS rm
    FROM pos_orders o
    JOIN pos_order_items oi ON oi.order_id = o.id
    JOIN "Outlet" ou ON ou."loyaltyOutletId" = o.outlet_id
    JOIN fin_outlet_companies fc ON fc.outlet_id = ou.id
    WHERE o.source='grabfood' AND o.status='completed'
      AND o.created_at >= ${start} AND o.created_at <= ${end}
    GROUP BY 1
  `);
  const consignGross = await prisma.$queryRaw<{ company_id: string; rm: number }[]>(Prisma.sql`
    SELECT fc.company_id, COALESCE(SUM(cs.gross),0)::float AS rm
    FROM consignment_sales cs
    JOIN fin_outlet_companies fc ON fc.outlet_id = cs.outlet_id
    WHERE cs.biz_date >= ${from}::date AND cs.biz_date <= ${to}::date
    GROUP BY 1
  `);

  // ── Cash in: classified bank credits per account (→ company) per channel ──
  const bank = await prisma.$queryRaw<{ suffix: string; category: string; rm: number }[]>(Prisma.sql`
    SELECT substring(s."accountName" from '\\((\\d{4})\\)') AS suffix,
           l.category::text AS category,
           COALESCE(SUM(l.amount),0)::float AS rm
    FROM "BankStatementLine" l
    JOIN "BankStatement" s ON s.id = l."statementId"
    WHERE l.direction='CR' AND l."isInterCo"=false
      AND l.category::text IN ('CARD','QR','REVENUE_MONSTER','GRAB','GRAB_PUTRAJAYA','GASTROHUB')
      AND l."txnDate" >= ${start} AND l."txnDate" <= ${end}
    GROUP BY 1,2
  `);
  const bankBy = (company: string, cats: string[]) => {
    const suffix = ACCOUNT_SUFFIX[company];
    return round2(bank.filter((b) => b.suffix === suffix && cats.includes(b.category)).reduce((s, b) => s + Number(b.rm), 0));
  };

  const companies = Object.keys(ACCOUNT_SUFFIX);
  const rev = (arr: { company_id: string; rm: number }[], c: string) => round2(Number(arr.find((r) => r.company_id === c)?.rm ?? 0));
  const tenderRev = (c: string, m: string) => round2(Number(tender.find((t) => t.company_id === c && t.method === m)?.rm ?? 0));

  const rows: CashInChannel[] = [];
  const push = (company: string, channel: CashInChannel["channel"], revenue: number, banked: number) => {
    if (revenue <= 0 && banked <= 0) return;
    const gap = round2(revenue - banked);
    const gapPct = revenue > 0 ? round2((gap / revenue) * 100) : null;
    const expectedPct = EXPECTED_PCT[channel];
    // Flag when the gap is meaningfully above the expected fee + timing buffer
    // (money missing), or negative beyond timing (banked > revenue = misclass).
    const overExpected = gapPct != null && gapPct > expectedPct + TIMING_BUFFER_PCT;
    const negative = gapPct != null && gapPct < -TIMING_BUFFER_PCT;
    const status: CashInChannel["status"] = overExpected || negative ? "review" : "ok";
    let note: string;
    if (channel === "grab" || channel === "consignment") {
      note = `Gross ${revenue}, net banked ${banked} (${gapPct}% taken at source vs ~${expectedPct}% commission).`;
    } else if (negative) {
      note = `Banked more than rung up, likely a settlement-timing spill or a misclassified credit.`;
    } else if (overExpected) {
      note = `Gap ${gapPct}% exceeds the ~${expectedPct}% fee + timing; part of the money rung up has not arrived.`;
    } else {
      note = `Within the ~${expectedPct}% fee + settlement timing.`;
    }
    rows.push({ company, channel, revenue, banked, gap, gapPct, expectedPct, status, note });
  };

  for (const c of companies) {
    push(c, "card", tenderRev(c, "card"), bankBy(c, ["CARD"]));
    push(c, "qr", tenderRev(c, "qr"), bankBy(c, ["QR"]));
    push(c, "online", rev(online, c), bankBy(c, ["REVENUE_MONSTER"]));
    push(c, "consignment", rev(consignGross, c), bankBy(c, ["GASTROHUB"]));
  }
  // Grab is GROUP-level: Conezion and Shah Alam Grab both settle into HQ's
  // account, so a per-entity split is meaningless. Revenue across all entities
  // vs Grab credits across all accounts.
  const grabRevAll = round2(grabGross.reduce((s, r) => s + Number(r.rm), 0));
  const grabBankAll = round2(bank.filter((b) => b.category === "GRAB" || b.category === "GRAB_PUTRAJAYA").reduce((s, b) => s + Number(b.rm), 0));
  push("group", "grab", grabRevAll, grabBankAll);

  const totals = rows.reduce((t, r) => ({ revenue: round2(t.revenue + r.revenue), banked: round2(t.banked + r.banked), gap: round2(t.gap + r.gap) }), { revenue: 0, banked: 0, gap: 0 });
  return { from, to, rows, totals };
}
