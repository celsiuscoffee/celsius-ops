import { api } from "../api";

export type Mode = "day" | "week" | "month" | "custom";
export type Granularity = "hour" | "day";

export type SeriesPoint = { label: string; cur: number | null; prev: number };
export type Channel = { key: string; label: string; revenue: number; orders: number; pct: number };
export type Round = { key: string; label: string; revenue: number; orders: number };
export type Payment = { key: string; label: string; amount: number; pct: number };

export type SalesDashboard = {
  outletId: string;
  outletName: string;
  availableOutlets?: { id: string; name: string }[];
  mode: Mode;
  granularity: Granularity;
  cur: { from: string; to: string; label: string };
  prev: { from: string; to: string; label: string };
  summary: {
    revenue: number; orders: number; aov: number;
    prevRevenue: number; prevOrders: number; prevAov: number;
    revenueDelta: number | null; ordersDelta: number | null; aovDelta: number | null;
  };
  series: SeriesPoint[];
  channels: Channel[];
  rounds: Round[];
  payments: Payment[];
  growth: {
    newCustomers: number; newCustomersDelta: number | null;
    newAppCustomers: number; newAppDelta: number | null;
    appOrders: number; appOrdersDelta: number | null;
    appSharePct: number; appShareDeltaPts: number;
    capturedOrders: number; collectionRatePct: number; collectionDeltaPts: number;
  };
  warnings?: string[];
};

export function fetchSalesDashboard(
  mode: Mode,
  outletId?: string | null,
  from?: string,
  to?: string,
): Promise<SalesDashboard> {
  const q = new URLSearchParams({ mode });
  if (outletId) q.set("outletId", outletId);
  if (from) q.set("from", from);
  if (to) q.set("to", to);
  return api<SalesDashboard>(`/api/sales/dashboard?${q.toString()}`);
}
