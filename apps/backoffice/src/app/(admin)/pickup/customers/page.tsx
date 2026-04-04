"use client";

import { useEffect, useState, useCallback } from "react";
import { Users, Search, Loader2, ChevronLeft, ChevronRight, Star, ShoppingBag, Phone } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";

interface Customer {
  id:                  string;
  phone:               string;
  name:                string | null;
  email:               string | null;
  birthday:            string | null;
  preferred_outlet_id: string | null;
  tags:                string[] | null;
  created_at:          string;
  current_points:      number;
  order_count:         number;
}

const OUTLET_LABELS: Record<string, string> = {
  "outlet-sa":  "Shah Alam",
  "outlet-con": "Conezion",
  "outlet-tam": "Tamarind",
};

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("60") && digits.length >= 10) {
    const local = digits.slice(2);
    if (local.length === 9)  return `+60 ${local.slice(0, 2)}-${local.slice(2, 5)} ${local.slice(5)}`;
    if (local.length === 10) return `+60 ${local.slice(0, 2)}-${local.slice(2, 6)} ${local.slice(6)}`;
  }
  return phone;
}

export default function PickupCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total,     setTotal]     = useState(0);
  const [page,      setPage]      = useState(1);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState("");
  const [query,     setQuery]     = useState("");

  const LIMIT = 25;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const load = useCallback(async (p: number, q: string) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (q) params.set("search", q);
    const res  = await adminFetch(`/api/pickup/customers?${params}`);
    const data = await res.json() as { customers?: Customer[]; total?: number };
    setCustomers(data.customers ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(1, ""); }, [load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(search);
    load(1, search);
  }

  function changePage(next: number) {
    setPage(next);
    load(next, query);
  }

  return (
    <div className="p-6 space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-[#160800]">Pickup Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {total.toLocaleString()} members synced from Loyalty App
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by phone or name..."
              className="pl-9 pr-3 py-2 text-sm border rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#160800]/20 w-60"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-semibold bg-[#160800] text-white rounded-xl hover:bg-[#160800]/90 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Users className="h-8 w-8 text-muted-foreground/40" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">
              {query ? "No customers match your search" : "No customers yet"}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Outlet</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Points</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">Orders</th>
                <th className="px-5 py-3.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                  {/* Name */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#160800]/10 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-[#160800]">
                          {c.name ? c.name.charAt(0).toUpperCase() : "#"}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-[#160800]">
                          {c.name ?? <span className="text-muted-foreground italic">No name</span>}
                        </p>
                        {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                      </div>
                    </div>
                  </td>
                  {/* Phone */}
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{formatPhone(c.phone ?? "")}</span>
                    </div>
                  </td>
                  {/* Preferred outlet */}
                  <td className="px-5 py-3.5">
                    {c.preferred_outlet_id ? (
                      <span className="text-xs font-medium bg-[#160800]/10 text-[#160800] px-2 py-0.5 rounded-full">
                        {OUTLET_LABELS[c.preferred_outlet_id] ?? c.preferred_outlet_id}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50 text-xs">—</span>
                    )}
                  </td>
                  {/* Points */}
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" />
                      <span className="font-semibold text-[#160800]">{c.current_points.toLocaleString()}</span>
                    </div>
                  </td>
                  {/* Orders */}
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className={c.order_count > 0 ? "font-semibold text-[#160800]" : "text-muted-foreground"}>
                        {c.order_count}
                      </span>
                    </div>
                  </td>
                  {/* Joined */}
                  <td className="px-5 py-3.5 text-muted-foreground text-xs">
                    {new Date(c.created_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <p>
            Showing {((page - 1) * LIMIT) + 1}-{Math.min(page * LIMIT, total)} of {total.toLocaleString()} customers
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => changePage(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 py-1 bg-white rounded-lg font-medium text-[#160800]">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => changePage(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
