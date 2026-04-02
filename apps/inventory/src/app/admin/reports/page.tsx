"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Package, ShoppingCart, Trash2, Truck, FileBarChart } from "lucide-react";

const REPORTS = [
  { name: "COGS Report", description: "Actual vs expected ingredient usage and cost variance per outlet per period", icon: DollarSign, color: "bg-red-50 text-red-600" },
  { name: "Stock Balance", description: "Current stock levels across all outlets — by product or packaging UOM", icon: Package, color: "bg-blue-50 text-blue-600" },
  { name: "Purchase Summary", description: "Total spending by supplier, product, and period with trend comparison", icon: ShoppingCart, color: "bg-green-50 text-green-600" },
  { name: "Wastage Report", description: "Cost of waste by reason (expired, spillage, breakage), outlet, and period", icon: Trash2, color: "bg-terracotta/10 text-terracotta" },
  { name: "Supplier Scorecard", description: "On-time delivery rate, short deliveries, price changes per supplier", icon: Truck, color: "bg-purple-50 text-purple-600" },
];

export default function ReportsPage() {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
      <p className="mt-0.5 text-sm text-gray-500">5 key reports for Celsius Coffee operations</p>

      <div className="mt-6 space-y-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <button key={report.name} className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 text-left transition-shadow hover:shadow-md">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${report.color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{report.name}</p>
                <p className="mt-0.5 text-sm text-gray-500">{report.description}</p>
              </div>
              <FileBarChart className="h-5 w-5 shrink-0 text-gray-300" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
