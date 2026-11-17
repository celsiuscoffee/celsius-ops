"use client";

import Link from "next/link";
import { DollarSign, Package, ShoppingCart, Trash2, Truck, Scale, Clock, ArrowRight } from "lucide-react";

const REPORTS = [
  { name: "Stock Valuation", description: "System qty vs last count with RM values — expected vs real inventory", icon: Package, color: "bg-info-soft text-info-text", href: "/inventory/reports/stock-valuation" },
  { name: "Usage Variance", description: "Actual usage (stock movements) vs expected (recipe BOM × sales) — over-portioning, theft, spoilage", icon: Scale, color: "bg-warn-soft text-warn-text", href: "/inventory/reports/ingredient-variance" },
  { name: "COGS Report", description: "Actual vs expected ingredient usage and cost variance per outlet per period", icon: DollarSign, color: "bg-danger-soft text-danger-text", href: "/inventory/reports/cogs" },
  { name: "Purchase Summary", description: "Total spending by supplier, product, and period with trend comparison", icon: ShoppingCart, color: "bg-ok-soft text-ok-text", href: "/inventory/reports/purchase-summary" },
  { name: "Wastage Report", description: "Cost of waste by reason (expired, spillage, breakage), outlet, and period", icon: Trash2, color: "bg-brand-soft text-brand-text", href: "/inventory/reports/wastage" },
  { name: "Prep Manhours", description: "Prep hours the period demanded (sales × recipes × prep time) vs rostered hours — is there enough labour to prep?", icon: Clock, color: "bg-info-soft text-info-text", href: "/inventory/reports/prep-labour" },
  { name: "Supplier Scorecard", description: "On-time delivery rate, short deliveries, price changes per supplier", icon: Truck, color: "bg-info-soft text-info-text", href: "/inventory/reports/supplier-scorecard" },
];

export default function ReportsPage() {
  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Stock reports</h1>
      <p className="mt-0.5 text-sm text-text-2">Deeper looks at stock, cost and usage when the overview is not enough.</p>

      <div className="mt-6 space-y-3">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          const content = (
            <div className="flex w-full items-center gap-4 rounded-xl border border-line bg-surface px-5 py-4 text-left transition-shadow hover:shadow-md">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${report.color}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-text">{report.name}</p>
                <p className="mt-0.5 text-sm text-text-2">{report.description}</p>
              </div>
              {report.href ? (
                <ArrowRight className="h-5 w-5 shrink-0 text-brand-text" />
              ) : (
                <span className="shrink-0 rounded-full bg-sunken px-2.5 py-0.5 text-xs text-text-3">Coming soon</span>
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
