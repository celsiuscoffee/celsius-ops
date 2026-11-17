"use client";

import { KeyNumber } from "@/components/ui/key-number";
// Stock › Overview (restructure step 6, 17 Nov 2026): what we hold, what it
// cost this month, and where it leaks. Celsius UI page pattern: title + one
// line, at most four key numbers each with a reference, a "needs you" strip,
// one list. Same two APIs as before; the purchasing totals that repeated
// Procurement were dropped.

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type InventoryDashboard = {
  ordersPlaced: number;
  pendingApprovals: number;
  deliveriesExpected: number;
  weeklySpending: number;
  wasteTotal: number;
  receivingsThisWeek: number;
  stockCheckDone: boolean;
  recentOrders: { id: string; orderNumber: string; supplier: string; status: string; totalAmount: number; createdAt: string }[];
};

type InventoryStats = {
  inventoryValue: number;
  cogsThisMonth: number;
  invoices: { total: number; pendingAmount: number; overdueAmount: number };
  products: number;
  suppliers: number;
};

const rm = (v: number | undefined | null) =>
  `RM ${Number(v ?? 0).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`;

// Order states as Celsius UI signals: blue = moving, amber = waiting on us,
// green = done, red = stopped, grey = not started.
const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: "bg-sunken text-text-2" },
  PENDING_APPROVAL: { label: "Needs approval", cls: "bg-warn-soft text-warn-text" },
  APPROVED: { label: "Approved", cls: "bg-info-soft text-info-text" },
  SENT: { label: "Sent", cls: "bg-info-soft text-info-text" },
  AWAITING_DELIVERY: { label: "Awaiting delivery", cls: "bg-info-soft text-info-text" },
  PARTIALLY_RECEIVED: { label: "Part received", cls: "bg-warn-soft text-warn-text" },
  COMPLETED: { label: "Received", cls: "bg-ok-soft text-ok-text" },
  CANCELLED: { label: "Cancelled", cls: "bg-danger-soft text-danger-text" },
};

export default function StockOverviewPage() {
  const { data: dash } = useFetch<InventoryDashboard>("/api/inventory/dashboard");
  const { data: stats } = useFetch<InventoryStats>("/api/inventory/admin/stats");

  // day of the month in Malaysia time, read once when the page opens
  const [day] = useState(() => Math.max(1, new Date(Date.now() + 8 * 3600_000).getUTCDate()));
  const cogsPerDay = stats ? stats.cogsThisMonth / day : 0;
  const daysCover = stats && cogsPerDay > 0 ? stats.inventoryValue / cogsPerDay : null;
  const wastePct = dash && dash.weeklySpending > 0 ? (dash.wasteTotal / dash.weeklySpending) * 100 : null;

  const needs: { href: string; text: string; tone: "warn" | "danger" | "info" }[] = [];
  if (dash?.pendingApprovals) needs.push({ href: "/inventory/orders?status=PENDING_APPROVAL", text: `${dash.pendingApprovals} purchase ${dash.pendingApprovals === 1 ? "order needs" : "orders need"} approval`, tone: "warn" });
  if (stats?.invoices.overdueAmount) needs.push({ href: "/inventory/invoices?status=OVERDUE", text: `${rm(stats.invoices.overdueAmount)} of supplier invoices overdue`, tone: "danger" });
  if (dash?.deliveriesExpected) needs.push({ href: "/inventory/receivings", text: `${dash.deliveriesExpected} ${dash.deliveriesExpected === 1 ? "delivery" : "deliveries"} to receive`, tone: "info" });

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Stock</h1>
        <p className="mt-1.5 text-sm text-text-2">What we hold, what it cost this month, and where it leaks.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber href="/inventory/reports" label="Stock value" value={stats ? rm(stats.inventoryValue) : null}
          note={daysCover !== null ? <>about <b className="text-text-2">{Math.round(daysCover)} days</b> of use at this month&apos;s rate</> : "across all outlets"} />
        <KeyNumber href="/inventory/reports" label="Cost of goods, this month" value={stats ? rm(stats.cogsThisMonth) : null}
          note={stats ? <><b className="text-text-2">{rm(cogsPerDay)}</b> a day over {day} {day === 1 ? "day" : "days"}</> : "—"} />
        <KeyNumber href="/inventory/wastage" label="Waste, last 7 days" value={dash ? rm(dash.wasteTotal) : null}
          tone={wastePct !== null && wastePct > 3 ? "warn" : undefined}
          note={wastePct !== null ? <><b className="text-text-2">{wastePct.toFixed(1)}%</b> of {rm(dash?.weeklySpending)} bought in the same 7 days</> : "of the last 7 days' purchases"} />
        <KeyNumber word href="/inventory/stock-count" label="Stock count, today" value={dash ? (dash.stockCheckDone ? "Done" : "Not yet") : null}
          tone={dash && !dash.stockCheckDone ? "warn" : undefined}
          note={dash ? (dash.stockCheckDone ? "today's count is in" : "no outlet has counted today") : "—"} />
      </div>

      {needs.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Needs you">
          {needs.map((n) => (
            <Link key={n.href} href={n.href}
              className={"inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium max-md:h-10 " +
                (n.tone === "danger" ? "bg-danger-soft text-danger-text" : n.tone === "warn" ? "bg-warn-soft text-warn-text" : "bg-info-soft text-info-text")}>
              {n.text} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      <section className="overflow-clip rounded-card border border-line bg-surface">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-text">Recent purchase orders</h2>
            <p className="mt-0.5 text-[12px] text-text-3">
              {dash ? `${dash.ordersPlaced} placed and ${dash.receivingsThisWeek} received in the last 7 days` : "What is on its way into stock"}
            </p>
          </div>
          <Link href="/inventory/orders" className="text-[13px] font-medium text-text-2 hover:text-text">PO list</Link>
        </div>
        {!dash ? (
          <div className="space-y-2 px-4 pb-4">{[1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-sunken" />)}</div>
        ) : dash.recentOrders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-line px-4 py-10 text-center">
            <ClipboardCheck className="size-6 text-text-3" aria-hidden />
            <p className="text-sm text-text-2">No purchase orders yet. Raise one from Procurement › Purchase Orders.</p>
          </div>
        ) : (
          <ul>
            {dash.recentOrders.slice(0, 8).map((o) => {
              const st = STATUS[o.status] ?? { label: o.status.replace(/_/g, " ").toLowerCase(), cls: "bg-sunken text-text-2" };
              return (
                <li key={o.id} className="border-t border-line">
                  <Link href={`/inventory/orders/${o.id}`} className="flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-raised">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-text">{o.supplier}</span>
                      <span className="block font-mono text-[12px] text-text-3">{o.orderNumber}</span>
                    </span>
                    <span className={"hidden shrink-0 rounded-full px-2 py-0.5 text-[12px] sm:inline " + st.cls}>{st.label}</span>
                    <span className="w-24 shrink-0 text-right font-mono text-[14px] font-semibold text-text">{rm(o.totalAmount)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
