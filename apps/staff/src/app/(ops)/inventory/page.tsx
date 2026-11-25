"use client";

import Link from "next/link";
import {
  ClipboardList,
  Package,
  Trash2,
  ArrowLeftRight,
  Receipt,
  ChevronRight,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { hasAccess } from "@/lib/access";
import { PageHeader } from "@/components/page-header";

type UserProfile = { role: string; moduleAccess?: Record<string, unknown> };

// The Stock tab: every stock job at the outlet, one row each.
const modules = [
  {
    href: "/stock-count",
    icon: ClipboardList,
    label: "Stock count",
    description: "Count what is on the shelf",
    moduleKey: "inventory:stock-count",
  },
  {
    href: "/receiving",
    icon: Package,
    label: "Receive a delivery",
    description: "Check a delivery against its order",
    moduleKey: "inventory:receivings",
  },
  {
    href: "/wastage",
    icon: Trash2,
    label: "Wastage",
    description: "Record waste and spills",
    moduleKey: "inventory:wastage",
  },
  {
    href: "/transfers",
    icon: ArrowLeftRight,
    label: "Transfers",
    description: "Send stock to another outlet, or take it in",
    moduleKey: "inventory:transfers",
  },
  {
    href: "/claims",
    icon: Receipt,
    label: "Pay and claim",
    description: "Bought something for the outlet? Claim it back",
    moduleKey: "inventory:pay-and-claim",
  },
];

export default function InventoryPage() {
  const { data: me, isLoading } = useFetch<UserProfile>("/api/auth/me");

  // Wait for the access check before rendering anything — flashing the
  // full list and then collapsing it would defeat the point.
  if (isLoading || !me) {
    return <div className="px-4 py-4" />;
  }

  const visible = modules.filter((m) => hasAccess(me.role, me.moduleAccess, m.moduleKey));

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Stock" description="Counting, deliveries, waste and transfers at your outlet." />

      {visible.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-2 px-4 py-8 text-center text-sm text-text-3">
          You don&apos;t have any stock jobs yet. Ask your manager if you need one.
        </p>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {visible.map((mod, i) => {
            const Icon = mod.icon;
            return (
              <Link
                key={mod.label}
                href={mod.href}
                className={`flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-sunken ${i > 0 ? "border-t border-line" : ""}`}
              >
                <Icon className="h-5 w-5 shrink-0 text-text-3" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-text">{mod.label}</p>
                  <p className="truncate text-[13px] text-text-3">{mod.description}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-text-3" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
