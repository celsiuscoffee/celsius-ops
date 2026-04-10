"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  ClipboardList,
  Package,
  Trash2,
  ArrowLeftRight,
  Receipt,
  ChevronRight,
} from "lucide-react";

const modules = [
  {
    href: "/stock-count",
    icon: ClipboardList,
    label: "Stock Count",
    description: "Daily stock check",
    color: "bg-terracotta/10 text-terracotta",
  },
  {
    href: "/receiving",
    icon: Package,
    label: "Receiving",
    description: "Record deliveries",
    color: "bg-blue-100 text-blue-600",
  },
  {
    href: "/wastage",
    icon: Trash2,
    label: "Wastage",
    description: "Report waste & spillage",
    color: "bg-red-100 text-red-600",
  },
  {
    href: "/transfers",
    icon: ArrowLeftRight,
    label: "Transfers",
    description: "Inter-outlet transfers",
    color: "bg-purple-100 text-purple-600",
  },
  {
    href: "/claims",
    icon: Receipt,
    label: "Pay & Claim",
    description: "Submit receipts for reimbursement",
    color: "bg-amber-100 text-amber-600",
  },
];

export default function InventoryPage() {
  return (
    <div className="px-4 py-4">
      <div className="space-y-4">
        <div>
          <h1 className="font-heading text-lg font-bold text-brand-dark">Inventory</h1>
          <p className="text-sm text-gray-500">Stock operations</p>
        </div>

        <div className="space-y-2">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link key={mod.label} href={mod.href}>
                <Card className="px-4 py-3 transition-all hover:shadow-sm active:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${mod.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{mod.label}</p>
                      <p className="text-xs text-gray-400">{mod.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
