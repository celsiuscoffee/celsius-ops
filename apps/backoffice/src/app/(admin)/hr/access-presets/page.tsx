"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";

type Row = {
  id: string;
  name: string;
  role: string;
  position: string | null;
  tier: string;
  matches: boolean;
  diff: string[];
};
type Report = { total: number; deviating: number; staff: Row[] };

const TIER_LABEL: Record<string, string> = {
  crew: "Crew", lead: "Lead", manager: "Manager", hq: "HQ / office",
};

export default function AccessPresetsPage() {
  const { data, isLoading, mutate } = useFetch<Report>("/api/hr/access-presets");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const apply = async (payload: { userId?: string; applyAll?: boolean }, key: string) => {
    setBusy(key);
    setMsg("");
    try {
      const res = await fetch("/api/hr/access-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) { setMsg(body.error || "Failed"); return; }
      setMsg(`Applied to ${body.applied} staff.`);
      mutate();
    } finally { setBusy(null); }
  };

  if (isLoading) return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-terracotta" /></div>;

  const deviating = (data?.staff ?? []).filter((s) => !s.matches);
  const ok = data ? data.total - data.deviating : 0;

  return (
    <div className="p-3 sm:p-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-terracotta" /> Staff app access
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Each staff member&apos;s floor-app access should match their position preset
          (Barista → Crew, Shift Lead → Lead, etc.). Anyone who drifted is flagged below.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Staff</p><p className="text-2xl font-semibold">{data?.total ?? 0}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-gray-500">On preset</p><p className="text-2xl font-semibold text-green-600">{ok}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-gray-500">Deviating</p><p className="text-2xl font-semibold text-amber-600">{data?.deviating ?? 0}</p></CardContent></Card>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <Button
          onClick={() => apply({ applyAll: true }, "all")}
          disabled={busy !== null || deviating.length === 0}
          className="bg-terracotta hover:bg-terracotta-dark"
        >
          {busy === "all" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Normalize all {deviating.length > 0 ? `(${deviating.length})` : ""}
        </Button>
        {msg && <span className="inline-flex items-center gap-1 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" />{msg}</span>}
      </div>

      {deviating.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-green-600">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6" /> Everyone matches their position preset.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {deviating.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{s.name}</span>
                      <Badge className="bg-gray-100 text-gray-600 text-[10px]">{s.role}</Badge>
                      <Badge className="bg-terracotta/10 text-terracotta text-[10px]">
                        {s.position || "no position"} · {TIER_LABEL[s.tier] ?? s.tier}
                      </Badge>
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {s.diff.map((d, i) => (
                        <li key={i} className="text-xs text-gray-500 flex items-center gap-1.5">
                          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" /><code>{d}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy !== null}
                    onClick={() => apply({ userId: s.id }, s.id)}>
                    {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Fix"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
