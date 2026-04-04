"use client";

import Link from "next/link";
import {
  ShoppingBag,
  Boxes,
  Gift,
  SlidersHorizontal,
  ArrowRight,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type UserProfile = {
  id: string;
  name: string;
  role: string;
};

const SECTIONS = [
  {
    title: "Pickup App",
    description: "Manage online orders, menus, and customer interactions",
    icon: ShoppingBag,
    href: "/pickup",
    color: "bg-orange-50 text-orange-600 border-orange-200",
    iconBg: "bg-orange-100",
  },
  {
    title: "Inventory",
    description: "Products, purchase orders, stock counts, and supplier management",
    icon: Boxes,
    href: "/inventory/products",
    color: "bg-blue-50 text-blue-600 border-blue-200",
    iconBg: "bg-blue-100",
  },
  {
    title: "Loyalty",
    description: "Members, rewards, campaigns, and engagement tools",
    icon: Gift,
    href: "/loyalty/members",
    color: "bg-purple-50 text-purple-600 border-purple-200",
    iconBg: "bg-purple-100",
  },
  {
    title: "Settings",
    description: "Outlets, staff access, approval rules, and integrations",
    icon: SlidersHorizontal,
    href: "/settings/outlets",
    color: "bg-gray-50 text-gray-600 border-gray-200",
    iconBg: "bg-gray-100",
  },
];

export default function DashboardPage() {
  const { data: user } = useFetch<UserProfile>("/api/auth/me");

  return (
    <div className="p-6 lg:p-8">
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Welcome back{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Celsius Ops Backoffice — manage all your operations from one place.
        </p>
      </div>

      {/* Section cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.title}
              href={section.href}
              className={`group flex flex-col rounded-xl border p-5 transition-all hover:shadow-md ${section.color}`}
            >
              <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${section.iconBg}`}>
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold">{section.title}</h2>
              <p className="mt-1 flex-1 text-xs opacity-70">{section.description}</p>
              <div className="mt-4 flex items-center gap-1 text-xs font-medium opacity-60 group-hover:opacity-100 transition-opacity">
                Open <ArrowRight className="h-3 w-3" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
