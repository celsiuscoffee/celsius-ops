"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  right?: ReactNode;
};

/**
 * Shared header for HR sub-pages on the staff app.
 * Renders a back-link + title row so every page has consistent navigation.
 */
export function HRPageHeader({ title, subtitle, backHref = "/hr", right }: Props) {
  return (
    <div className="mb-4 flex items-center gap-3 pt-6">
      <Link
        href={backHref}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
        aria-label="Back"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-bold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
