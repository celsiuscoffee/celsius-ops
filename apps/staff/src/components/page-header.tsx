"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  title: string;
  /** One line: the question this page answers. */
  description?: ReactNode;
  /** Sub-pages get a back link; tab roots do not. */
  backHref?: string;
  right?: ReactNode;
};

/**
 * Celsius UI page header for the Staff app: title and a one-line
 * description, with a 44 px back link on sub-pages.
 */
export function PageHeader({ title, description, backHref, right }: Props) {
  return (
    <div className="mb-4 flex items-center gap-2 pt-5">
      {backHref && (
        <Link
          href={backHref}
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-2 active:bg-sunken"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <div className="min-w-0 flex-1">
        <h1 className={`truncate font-heading font-semibold text-text ${backHref ? "text-xl" : "text-[28px] leading-9"}`}>{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-text-3">{description}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
