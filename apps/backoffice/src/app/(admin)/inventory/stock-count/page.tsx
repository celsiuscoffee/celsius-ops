"use client";

import { ClipboardCheck } from "lucide-react";

export default function StockCountPage() {
  return (
    <div className="flex flex-col items-center justify-center py-32 px-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
        <ClipboardCheck className="h-8 w-8 text-gray-400" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-gray-900">Stock Count</h2>
      <p className="mt-1.5 text-sm text-gray-500">Coming Soon</p>
      <p className="mt-1 max-w-sm text-center text-xs text-gray-400">
        Count and reconcile physical inventory against system records across all outlets.
      </p>
    </div>
  );
}
