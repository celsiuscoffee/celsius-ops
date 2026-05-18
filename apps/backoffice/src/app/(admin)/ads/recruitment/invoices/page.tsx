"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Receipt, ExternalLink, AlertCircle } from "lucide-react";

export default function RecruitmentInvoicesPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Link href="/ads/recruitment" className="hover:underline">Recruitment</Link>
          <span>/</span>
          <span>Invoices</span>
        </div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Receipt className="h-6 w-6 text-terracotta" /> Indeed Invoices
        </h1>
      </div>

      <Card className="p-4 border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 flex gap-3 items-start">
        <AlertCircle className="h-5 w-5 text-amber-700 dark:text-amber-300 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
          <p className="font-medium">Indeed invoices live on Indeed&apos;s billing portal.</p>
          <p>
            Unlike Google Ads, Indeed&apos;s Sponsored Jobs API does not expose invoice PDFs or
            line-item billing data programmatically. Use the link below to download invoices
            directly from Indeed and reconcile against the spend totals shown on the{" "}
            <Link href="/ads/recruitment" className="underline">Overview</Link> page.
          </p>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-medium">Where to find Indeed invoices</h2>
        <ol className="space-y-3 text-sm text-muted-foreground list-decimal list-inside">
          <li>
            Sign in at{" "}
            <a
              href="https://employers.indeed.com/billing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-terracotta hover:underline inline-flex items-center gap-1"
            >
              employers.indeed.com/billing <ExternalLink className="h-3 w-3" />
            </a>
          </li>
          <li>Pick the billing period</li>
          <li>Download invoice PDF + CSV transaction report</li>
          <li>
            For reconciliation: cross-check the invoice total against the spend totals shown on{" "}
            <Link href="/ads/recruitment" className="text-terracotta hover:underline">Overview</Link>{" "}
            for the same date range. Differences usually come from billing-day cutoffs versus reporting-day cutoffs.
          </li>
        </ol>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-medium">Future work</h2>
        <p className="text-sm text-muted-foreground">
          If Indeed publishes an invoice API for direct employers (currently only available to
          ATS partners), this page will be wired to ingest invoices automatically — same pattern
          as the Google Ads invoices module.
        </p>
      </Card>
    </div>
  );
}
