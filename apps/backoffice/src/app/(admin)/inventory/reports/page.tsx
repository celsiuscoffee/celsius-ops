"use client";

import Link from "next/link";
import { DollarSign, Package, ShoppingCart, Trash2, Truck, ArrowRight } from "lucide-react";

const REPORTS = [
  { name: "Stock Valuation", description: "System qty vs last count with RM values — expected vs real inventory", icon: Package, color: "bg-blue-50 text-blue-600", href: "/inventory/reports/stock-valuation" },
  { name: "COGS Report", description: "Actual vs expected ingredient usage and cost variance per outlet per period", icon: DollarSign, color: "bg-red-50 text-red-600", href: "/inventory/reports/cogs" },
  { name: "Purchase Summary", description: "Total spending by supplier, product, and period with trend comparison", icon: ShoppingCart, color: "bg-green-50 text-green-600", href: "/inventory/reports/purchase-summary" },
  { name: "Wastage Report", description: "Cost of waste by reason (expired, spillage, breakage), outlet, and period", icon: Trash2, color: "bg-terracotta/10 text-terracotta", href: "/inventory/reports/wastage" },
  { name: "Supplier Scorecard", description: "On-time delivery rate, short deliveries, price changes per supplier", icon: Truck, color: "bg-purple-50 text-purple-600", href: "/inventory/reports/supplier-scorecard" },
];

export default function ReportsPage() {
  return (
    <div className="p-3 sm:p-6">
      <h2 className="text-xl font-semibold text-gray-900">Reports</h2>
      <p className="mt-0.5 text-sm text-gray-500">{REPORTS.length} reports for Celsius Coffee operations</p>

      <div className="mt-6 space-y-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          const content = (
            <div className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 text-left transition-shadow hover:shadow-md">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${report.color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-900">{report.name}</p>
                <p className="mt-0.5 text-sm text-gray-500">{report.description}</p>
              </div>
              {report.href ? (
                <ArrowRight className="h-5 w-5 shrink-0 text-terracotta" />
              ) : (
                <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-400">Coming soon</span>
              )}
            </div>
          );

          if (report.href) {
            return <Link key={report.name} href={report.href}>{content}</Link>;
          }
          return <div key={report.name} className="cursor-not-allowed opacity-60">{content}</div>;
        })}
      </div>
    </div>
  );
}
