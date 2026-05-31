import { api } from "../api";

export type StockItem = {
  id: string;
  name: string;
  sku: string;
  baseUom: string;
  storageArea: string;
  category: string;
  quantity: number;
  parLevel: number | null;
  reorderPoint: number | null;
  status: "critical" | "low" | "ok" | "no_par";
};

export function fetchStockLevels(outletId?: string | null) {
  const q = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
  return api<{ items: StockItem[] }>(`/api/inventory${q}`);
}
