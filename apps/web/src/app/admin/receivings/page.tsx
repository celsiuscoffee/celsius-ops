"use client";

import { useState, useEffect, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Search,
  ChevronDown,
  Loader2,
  Package,
  CheckCircle2,
  AlertTriangle,
  Camera,
} from "lucide-react";

type ReceivingItem = {
  id: string;
  product: string;
  sku: string;
  package: string;
  orderedQty: number | null;
  receivedQty: number;
  expiryDate: string | null;
  discrepancyReason: string | null;
};

type Receiving = {
  id: string;
  orderNumber: string;
  branch: string;
  supplier: string;
  receivedBy: string;
  receivedAt: string;
  status: string;
  notes: string | null;
  photoCount: number;
  items: ReceivingItem[];
};

export default function ReceivingsPage() {
  const [receivings, setReceivings] = useState<Receiving[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/receivings")
      .then((res) => res.json())
      .then((data) => { setReceivings(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = receivings.filter((r) =>
    r.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
    r.supplier.toLowerCase().includes(search.toLowerCase()) ||
    r.branch.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Receivings</h2>
          <p className="mt-0.5 text-sm text-gray-500">{receivings.length} delivery records</p>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Receivings</p>
          <p className="text-xl font-bold text-gray-900">{receivings.length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Complete</p>
          <p className="text-xl font-bold text-green-600">{receivings.filter((r) => r.status === "COMPLETE").length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Partial / Disputed</p>
          <p className="text-xl font-bold text-amber-600">{receivings.filter((r) => r.status !== "COMPLETE").length}</p>
        </Card>
      </div>

      {/* Search */}
      <div className="mt-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input placeholder="Search by PO#, supplier, or branch..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">PO Reference</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Branch</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Supplier</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Items</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Photos</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Received By</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Date</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Package className="mx-auto h-8 w-8 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    {receivings.length === 0
                      ? "No receivings yet. Deliveries confirmed in the mobile app will appear here."
                      : "No receivings match your search."}
                  </p>
                </td>
              </tr>
            )}
            {filtered.map((rec) => (
              <Fragment key={rec.id}>
                <tr
                  className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                >
                  <td className="px-3 py-3">
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === rec.id ? "rotate-180" : ""}`} />
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-terracotta">{rec.orderNumber}</code>
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{rec.branch}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{rec.supplier}</td>
                  <td className="px-4 py-3">
                    <Badge className={`text-[10px] ${rec.status === "COMPLETE" ? "bg-green-500" : rec.status === "PARTIAL" ? "bg-amber-500" : "bg-red-500"}`}>
                      {rec.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{rec.items.length} items</td>
                  <td className="px-4 py-3">
                    {rec.photoCount > 0 ? (
                      <span className="flex items-center gap-1 text-xs text-gray-500"><Camera className="h-3 w-3" />{rec.photoCount}</span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{rec.receivedBy}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(rec.receivedAt).toLocaleDateString("en-MY")}
                  </td>
                </tr>
                {expandedId === rec.id && (
                  <tr>
                    <td colSpan={9} className="bg-gray-50 px-8 py-3">
                      <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">Received Items</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="pb-1 text-left font-medium">Product</th>
                            <th className="pb-1 text-left font-medium">SKU</th>
                            <th className="pb-1 text-right font-medium">Ordered</th>
                            <th className="pb-1 text-right font-medium">Received</th>
                            <th className="pb-1 text-left font-medium">Status</th>
                            <th className="pb-1 text-left font-medium">Expiry</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rec.items.map((item) => {
                            const match = item.orderedQty === null || item.receivedQty === item.orderedQty;
                            const short = item.orderedQty !== null && item.receivedQty < item.orderedQty;
                            return (
                              <tr key={item.id} className="border-t border-gray-200/50">
                                <td className="py-1.5 text-gray-700">{item.product}</td>
                                <td className="py-1.5"><code className="text-gray-500">{item.sku}</code></td>
                                <td className="py-1.5 text-right text-gray-500">{item.orderedQty ?? "—"}</td>
                                <td className="py-1.5 text-right text-gray-700 font-medium">{item.receivedQty}</td>
                                <td className="py-1.5">
                                  {match ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                                  ) : short ? (
                                    <span className="flex items-center gap-1 text-red-500">
                                      <AlertTriangle className="h-3 w-3" />
                                      Short
                                    </span>
                                  ) : null}
                                </td>
                                <td className="py-1.5 text-gray-500">{item.expiryDate ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {rec.notes && <p className="mt-2 text-xs text-gray-500">Notes: {rec.notes}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
