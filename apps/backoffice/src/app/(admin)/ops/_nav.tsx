"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, ClipboardList, ClipboardCheck, BookOpen, Users } from "lucide-react";

// Templates intentionally omitted from AUDIT_TABS — audit templates live in
// the SOPs tab set (SopNav) to avoid duplication.
const AUDIT_TABS = [
  { href: "/ops/audit", label: "Checklists", icon: FileText },
  { href: "/ops/audit-reports", label: "Reports", icon: ClipboardCheck },
  { href: "/ops/staff-skills", label: "Staff skills", icon: Users },
];

const SOP_TABS = [
  { href: "/ops/sops", label: "SOPs", icon: BookOpen },
  { href: "/ops/audit-templates", label: "Audit templates", icon: ClipboardList },
];

function TabBar({ tabs }: { tabs: typeof AUDIT_TABS }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-x-6 border-b border-line">
      {tabs.map((t) => {
        const active = pathname === t.href;
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "-mb-px flex min-h-10 items-center gap-2 border-b-2 text-sm transition " +
              (active
                ? "border-text font-semibold text-text"
                : "border-transparent text-text-2 hover:text-text")
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
