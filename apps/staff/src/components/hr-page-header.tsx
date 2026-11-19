"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  right?: ReactNode;
};

/** Header for the pages under Shifts: back to /hr by default. */
export function HRPageHeader({ title, subtitle, backHref = "/hr", right }: Props) {
  return <PageHeader title={title} description={subtitle} backHref={backHref} right={right} />;
}
