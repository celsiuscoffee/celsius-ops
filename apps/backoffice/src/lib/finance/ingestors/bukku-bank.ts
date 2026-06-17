// Bukku bank-feed adapter — IO. Pulls Money In / Money Out from the Bukku Bank
// API, maps them to bank lines (bukku-bank-map.ts), and lands them in
// fin_bank_transactions via ingestBankLines. The Matcher then reconciles them.
//
// Auth: the API access token is company-scoped (generated per Bukku company at
// Control Panel → Integrations), so the token alone selects the company — no
// company header. Base: https://api.bukku.my. Rate limit: 600 req/min.

import { prisma } from "@/lib/prisma";
import { ingestBankLines, type BankIngestResult } from "./bank-feed";
import { mapBukkuTransactions, type BukkuBankTxn, type BukkuListResponse } from "./bukku-bank-map";
import { probeBukkuOutlet, type BukkuProbe } from "./bukku-bank-probe";
import type { BankLineInput } from "./bank-feed-build";

export type { BukkuProbe } from "./bukku-bank-probe";

const DEFAULT_BASE_URL = "https://api.bukku.my";
const PAGE_SIZE = 100;

async function fetchPaged(
  base: string,
  resource: "incomes" | "expenses",
  token: string,
  dateFrom: string,
  dateTo: string
): Promise<BukkuBankTxn[]> {
  const out: BukkuBankTxn[] = [];
  for (let page = 1; page < 1000; page++) {
    const url = `${base}/banking/${resource}?date_from=${dateFrom}&date_to=${dateTo}&page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Bukku /banking/${resource} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as BukkuListResponse;
    const txns = json.transactions ?? [];
    out.push(...txns);
    const paging = json.paging;
    if (txns.length === 0 || !paging || page * paging.per_page >= paging.total) break;
  }
  return out;
}

// Fetch + map one Bukku company's bank lines for a date range.
export async function fetchBukkuBankLines(opts: {
  token: string;
  dateFrom: string;
  dateTo: string;
  baseUrl?: string;
}): Promise<BankLineInput[]> {
  const base = opts.baseUrl ?? DEFAULT_BASE_URL;
  const [incomes, expenses] = await Promise.all([
    fetchPaged(base, "incomes", opts.token, opts.dateFrom, opts.dateTo),
    fetchPaged(base, "expenses", opts.token, opts.dateFrom, opts.dateTo),
  ]);
  return mapBukkuTransactions(incomes, expenses);
}

export type BukkuSyncResult = {
  from: string;
  to: string;
  outlets: Array<{ outlet: string; fetched?: number; error?: string }>;
  ingest: BankIngestResult;
};

// Sync every Bukku-enabled outlet's bank feed into fin_bank_transactions for a
// date range. Per-outlet failures are isolated (one bad token doesn't sink the
// rest); all lines are landed in a single idempotent ingest.
export async function syncBukkuBankFeed(opts: { from: string; to: string; baseUrl?: string }): Promise<BukkuSyncResult> {
  const outlets = await prisma.outlet.findMany({
    where: { bukkuEnabled: true, bukkuToken: { not: null } },
    select: { id: true, name: true, bukkuToken: true },
  });

  const all: BankLineInput[] = [];
  const perOutlet: BukkuSyncResult["outlets"] = [];
  for (const o of outlets) {
    try {
      const lines = await fetchBukkuBankLines({ token: o.bukkuToken!, dateFrom: opts.from, dateTo: opts.to, baseUrl: opts.baseUrl });
      all.push(...lines);
      perOutlet.push({ outlet: o.name, fetched: lines.length });
    } catch (err) {
      perOutlet.push({ outlet: o.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const ingest = await ingestBankLines(all);
  return { from: opts.from, to: opts.to, outlets: perOutlet, ingest };
}

// Probe every Bukku-enabled outlet for a recent window (read-only, no ingest).
// The per-token probe lives in bukku-bank-probe.ts (no prisma, so it's
// unit-tested with a stubbed fetch); this just loads the tokens.
export async function probeBukkuBankFeed(opts: { from: string; to: string; baseUrl?: string }): Promise<BukkuProbe[]> {
  const outlets = await prisma.outlet.findMany({
    where: { bukkuEnabled: true, bukkuToken: { not: null } },
    select: { name: true, bukkuToken: true },
  });
  const results: BukkuProbe[] = [];
  for (const o of outlets) {
    results.push(await probeBukkuOutlet({ outlet: o.name, token: o.bukkuToken!, from: opts.from, to: opts.to, baseUrl: opts.baseUrl }));
  }
  return results;
}

