"use client";

// Bukku-style company switcher for the finance module. Sets a cookie on the
// server, then reloads the page so SWR data is re-fetched under the new
// company scope.

import { useState, useRef, useEffect } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";

type Company = { id: string; name: string; brn: string | null; tin: string | null; isDefault: boolean; isActive: boolean };

export function CompanySwitcher() {
  const { data, isLoading } = useFetch<{ companies: Company[]; activeCompanyId: string }>(
    "/api/finance/companies"
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  if (isLoading || !data) {
    return (
      <button className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading...
      </button>
    );
  }

  const active = data.companies.find((c) => c.id === data.activeCompanyId);

  async function pick(id: string) {
    if (id === data?.activeCompanyId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/finance/companies/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: id }),
      });
      if (res.ok) {
        // Hard reload so all SWR caches refetch under the new company scope.
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:border-foreground/40"
      >
        <Building2 className="h-4 w-4" />
        <span className="font-medium">{active?.name ?? "Pick company"}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border bg-background shadow-lg">
          <ul className="max-h-80 overflow-y-auto py-1">
            {data.companies
              .filter((c) => c.isActive)
              .map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => pick(c.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted"
                  >
                    <span className="flex flex-col items-start">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.id}{c.brn ? ` · ${c.brn}` : ""}</span>
                    </span>
                    {c.id === data.activeCompanyId && <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
