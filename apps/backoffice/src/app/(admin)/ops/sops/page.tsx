"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyNumber } from "@/components/ui/key-number";
import { Plus, Search, Loader2, FileText, Trash2, ListChecks, Building2 } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { SopNav } from "../_nav";

type Category = { id: string; name: string };

type Sop = {
  id: string; title: string; description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; version: number;
  expectedRecurrence: "SHIFT" | "SPECIFIC_TIMES" | "HOURLY";
  expectedTimesPerDay: number;
  expectedTimes: string[];
  category: { id: string; name: string };
  createdBy: { id: string; name: string };
  _count: { steps: number; sopOutlets: number };
  createdAt: string;
};

const FREQ_LABELS: Record<string, string> = {
  SHIFT: "Per shift",
  SPECIFIC_TIMES: "Specific times",
  HOURLY: "Hourly",
};

const STATUS_WORDS: Record<string, string> = { DRAFT: "Draft", PUBLISHED: "In use", ARCHIVED: "Archived" };
// "14:00" -> "2:00 PM"
const hm12 = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h)) return hm;
  return `${h % 12 || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-warn-soft text-warn-text",
  PUBLISHED: "bg-ok-soft text-ok-text",
  ARCHIVED: "bg-sunken text-text-2",
};

export default function SopsPage() {
  const { data: sops, isLoading, mutate } = useFetch<Sop[]>("/api/ops/sops");
  const { data: categories } = useFetch<Category[]>("/api/ops/sop-categories");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [catFilter, setCatFilter] = useState("ALL");

  const filtered = (sops ?? []).filter((s) => {
    if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
    if (catFilter !== "ALL" && s.category.id !== catFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q);
    }
    return true;
  });

  const published = (sops ?? []).filter((x) => x.status === "PUBLISHED");
  const drafts = (sops ?? []).filter((x) => x.status === "DRAFT").length;
  const noOutlet = published.filter((x) => x._count.sopOutlets === 0).length;
  const noSteps = (sops ?? []).filter((x) => x.status !== "ARCHIVED" && x._count.steps === 0).length;

  const deleteSop = async (id: string) => {
    if (!confirm("Delete this SOP?")) return;
    await fetch(`/api/ops/sops/${id}`, { method: "DELETE" });
    mutate();
  };

  return (
    <div className="max-w-[1100px] space-y-5 px-4 pt-6 pb-10 md:px-8">
      <SopNav />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">SOPs</h1>
          <p className="mt-0.5 text-sm text-text-2">How each job is done, which outlets follow it, and how often it runs.</p>
        </div>
        <Link href="/ops/sops/new" className="inline-flex h-10 items-center gap-1.5 self-start rounded-ctl bg-ink px-4 text-sm font-medium text-on-ink hover:bg-ink-hover">
          <Plus className="h-4 w-4" />Create SOP
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="In use" value={sops ? String(published.length) : null}
          note={<>of <b className="font-semibold text-text-2">{sops?.length ?? 0}</b> SOPs written</>} />
        <KeyNumber label="Drafts" value={sops ? String(drafts) : null} tone={drafts > 0 ? "warn" : undefined}
          note={drafts > 0 ? "staff do not see these yet" : "nothing waiting to publish"} />
        <KeyNumber label="In use, no outlet" value={sops ? String(noOutlet) : null} tone={noOutlet > 0 ? "warn" : undefined}
          note={noOutlet > 0 ? "published but no outlet runs them" : "every SOP has an outlet"} />
        <KeyNumber label="No steps" value={sops ? String(noSteps) : null} tone={noSteps > 0 ? "warn" : undefined}
          note={noSteps > 0 ? "nothing for staff to tick" : "every SOP has steps"} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search SOPs…" className="pl-9" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text">
          <option value="ALL">Any status</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">In use</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)}
          className="h-10 rounded-ctl border border-line bg-surface px-3 text-sm text-text">
          <option value="ALL">All categories</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-text" /></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-line bg-surface py-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-text-3" />
          <p className="mt-3 text-sm text-text-2">{sops?.length === 0 ? "No SOPs yet" : "No matches"}</p>
          {sops?.length === 0 && (
            <Link href="/ops/sops/new"><Button variant="outline" className="mt-4"><Plus className="mr-2 h-4 w-4" />Create first SOP</Button></Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
              {filtered.map((s) => (
                <div key={s.id} className="border-b border-line last:border-b-0">
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <Link href={`/ops/sops/${s.id}`} className="text-sm font-medium text-text hover:underline">{s.title}</Link>
                        {s.description && <p className="mt-0.5 truncate text-[12px] text-text-3">{s.description}</p>}
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="rounded-full bg-sunken px-2 py-0.5 text-[11px] text-text-2">{s.category.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COLORS[s.status]}`}>{STATUS_WORDS[s.status]}</span>
                          <span className="text-[12px] text-text-3">{FREQ_LABELS[s.expectedRecurrence]}</span>
                          {s.expectedRecurrence === "SPECIFIC_TIMES" && s.expectedTimes?.length > 0 && (
                            <span className="text-[12px] text-text-3">{s.expectedTimes.map(hm12).join(", ")}</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-3 text-[12px] text-text-3">
                          <span className="flex items-center gap-1"><ListChecks className="h-3 w-3" />{s._count.steps} steps</span>
                          <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{s._count.sopOutlets} outlets</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Link href={`/ops/sops/${s.id}`}>
                          <Button size="sm" variant="outline" className="h-9 text-xs">Edit</Button>
                        </Link>
                        <Button size="sm" variant="outline" aria-label={`Delete ${s.title}`} className="h-9 w-9 text-xs text-danger-text hover:bg-danger-soft" onClick={() => deleteSop(s.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
        </div>
      )}
    </div>
  );
}
