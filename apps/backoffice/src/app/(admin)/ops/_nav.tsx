"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, ClipboardList, ClipboardCheck, BookOpen } from "lucide-react";

// Templates intentionally omitted from AUDIT_TABS — audit templates live in
// the SOPs tab set (SopNav) to avoid duplication.
const AUDIT_TABS = [
  { href: "/ops/audit", label: "Checklist Audit", icon: FileText },
  { href: "/ops/audit-reports", label: "Reports", icon: ClipboardCheck },
];

const SOP_TABS = [
  { href: "/ops/sops", label: "SOPs", icon: BookOpen },
  { href: "/ops/audit-templates", label: "Audit Templates", icon: ClipboardList },
];

function TabBar({ tabs }: { tabs: typeof AUDIT_TABS }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-1 border-b pb-2">
      {tabs.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (active
                ? "bg-terracotta text-white"
                : "text-gray-600 hover:bg-gray-100")
            }
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AuditNav() {
  return <TabBar tabs={AUDIT_TABS} />;
}

export function SopNav() {
  return <TabBar tabs={SOP_TABS} />;
}
