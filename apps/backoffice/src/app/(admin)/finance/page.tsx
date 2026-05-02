"use client";

// Finance home — QuickBooks-style Business Feed: agent activity, exception
// banner, cash position cards, MTD revenue. Real data from /api/finance/home.

import Link from "next/link";
import { useFetch } from "@/lib/use-fetch";
import { CompanySwitcher } from "@/components/finance/company-switcher";
import {
  Banknote,
  Inbox,
  TrendingUp,
  ShieldCheck,
  Bot,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from "lucide-react";

type HomeData = {
  asOf: string;
  mtd: { start: string; revenue: number };
  exceptions: { total: number; urgent: number; high: number };
  cashPosition: Array<{ code: string; name: string; balance: number }>;
  agentActivity: Array<{ agent: string; count: number; amount: number }>;
  recentPosts: Array<{
    id: string;
    txn_date: string;
    description: string;
    amount: number;
    posted_by_agent: string | null;
    confidence: number | null;
  }>;
};

const RM = (n: number) =>
  new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(n);

const QUICK_LINKS = [
  { href: "/finance/transactions", icon: Banknote, label: "Transactions" },
  { href: "/finance/inbox", icon: Inbox, label: "Inbox" },
  { href: "/finance/reports", icon: TrendingUp, label: "Reports" },
  { href: "/finance/compliance", icon: ShieldCheck, label: "Compliance" },
];

export default function FinanceHome() {
  const { data, error, isLoading } = useFetch<HomeData>("/api/finance/home");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Finance</h1>
          <p className="text-sm text-muted-foreground">
            Agentic finance module. The agents handle the books — you handle the exceptions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CompanySwitcher />
          <nav className="flex gap-2">
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:border-foreground/40"
              >
                <l.icon className="h-4 w-4" />
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading the books...
        </div>
      )}
      {error && <div className="text-sm text-rose-500">Failed to load home: {String(error)}</div>}

      {data && (
        <>
          {/* Exception banner — only shown if there are open items */}
          {data.exceptions.total > 0 && (
            <Link
              href="/finance/inbox"
              className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 hover:bg-amber-500/10"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                <div>
                  <div className="font-medium">
                    {data.exceptions.total} item{data.exceptions.total > 1 ? "s" : ""} need your review
                  </div>
                  {(data.exceptions.urgent > 0 || data.exceptions.high > 0) && (
                    <div className="text-sm text-muted-foreground">
                      {data.exceptions.urgent > 0 && `${data.exceptions.urgent} urgent · `}
                      {data.exceptions.high > 0 && `${data.exceptions.high} high priority`}
                    </div>
                  )}
                </div>
              </div>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}

          {/* MTD + Cash position row */}
          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Revenue MTD
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{RM(data.mtd.revenue)}</div>
              <div className="mt-1 text-xs text-muted-foreground">since {data.mtd.start}</div>
            </div>
            {data.cashPosition.slice(0, 2).map((c) => (
              <div key={c.code} className="rounded-lg border p-4">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {c.name}
                </div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${
                    c.balance < 0 ? "text-rose-600 dark:text-rose-400" : ""
                  }`}
                >
                  {RM(c.balance)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{c.code}</div>
              </div>
            ))}
          </section>

          {/* Agent activity feed — QuickBooks Business Feed pattern */}
          <section className="rounded-lg border">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4" />
                <span className="font-medium">Agent activity</span>
              </div>
              <span className="text-xs text-muted-foreground">last 24h</span>
            </header>
            <div className="divide-y">
              {data.agentActivity.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No agent activity yet. Run the StoreHub EOD ingest to backfill.
                </div>
              )}
              {data.agentActivity.map((a) => (
                <div key={a.agent} className="flex items-center justify-between px-4 py-3">
                  <div className="text-sm">
                    <span className="font-medium">{labelForAgent(a.agent)}</span>{" "}
                    posted{" "}
                    <span className="font-medium tabular-nums">
                      {a.count} journal{a.count > 1 ? "s" : ""}
                    </span>{" "}
                    totalling{" "}
                    <span className="font-medium tabular-nums">{RM(a.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Recent posts — quick scan */}
          {data.recentPosts.length > 0 && (
            <section className="rounded-lg border">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <span className="font-medium">Recent journals</span>
                <Link
                  href="/finance/transactions"
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  View all →
                </Link>
              </header>
              <div className="divide-y">
                {data.recentPosts.slice(0, 8).map((p) => (
                  <Link
                    key={p.id}
                    href={`/finance/transactions`}
                    className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/30"
                  >
                    <div className="flex flex-1 items-center gap-3">
                      <div className="text-xs tabular-nums text-muted-foreground">{p.txn_date}</div>
                      <div className="flex-1 truncate">{p.description}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">
                        {p.posted_by_agent}
                        {p.confidence !== null &&
                          ` · ${Math.round(Number(p.confidence) * 100)}%`}
                      </span>
                      <span className="font-medium tabular-nums">{RM(Number(p.amount))}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function labelForAgent(agent: string): string {
  return (
    {
      ar: "AR autopilot",
      ap: "AP autopilot",
      categorizer: "Categorizer",
      matcher: "Matcher",
      close: "Close agent",
      compliance: "Compliance agent",
      anomaly: "Anomaly detector",
      manual: "Manual entry",
    }[agent] ?? agent
  );
}
