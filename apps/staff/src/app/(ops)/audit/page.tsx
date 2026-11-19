"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck, Loader2, CheckCircle2, Clock, Plus, ChevronRight, Building2, Trash2,
} from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import { PageHeader } from "@/components/page-header";

type UserProfile = { id: string; name: string; role: string; outletId: string | null; moduleAccess?: Record<string, boolean> };
type Outlet = { id: string; name: string; code: string };
type Template = {
  id: string; name: string; description: string | null; roleType: string;
  auditTarget: "OUTLET" | "STAFF";
  jobRoleFilter: string[];
  sections: { id: string; name: string; _count: { items: number } }[];
};
type Auditee = { id: string; name: string; position: string | null };
type AuditSummary = {
  id: string; date: string; status: string; overallScore: number | null;
  completedAt: string | null;
  template: { id: string; name: string; roleType: string };
  outlet: { id: string; name: string; code: string };
  auditor: { id: string; name: string };
  isMine: boolean;
  totalItems: number; completedItems: number; progress: number;
};
export default function AuditPage() {
  const router = useRouter();
  const { data: me } = useFetch<UserProfile>("/api/auth/me");
  const { data: audits, isLoading, mutate } = useFetch<AuditSummary[]>("/api/audits");
  const { data: templates } = useFetch<Template[]>("/api/audits/templates");
  const { data: outlets } = useFetch<Outlet[]>("/api/audits/outlets");

  const [showNew, setShowNew] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [selectedAuditee, setSelectedAuditee] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Delete handler shared between in-progress and completed lists. The button
  // sits inside the Link wrapper, so we stop propagation to prevent navigation.
  const handleDelete = async (e: React.MouseEvent, auditId: string, templateName: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${templateName}"? All ratings and photos for this audit will be lost.`)) return;
    setDeletingId(auditId);
    try {
      const res = await fetch(`/api/audits/${auditId}`, { method: "DELETE" });
      if (res.ok) {
        mutate();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to delete audit");
      }
    } finally {
      setDeletingId(null);
    }
  };

  // Auditee list — only relevant for STAFF templates. Re-fetched whenever
  // template or outlet changes so the list always matches the current pick.
  const tpl = (templates ?? []).find((t) => t.id === selectedTemplate);
  const isStaffTemplate = tpl?.auditTarget === "STAFF";
  const auditeesUrl =
    isStaffTemplate && selectedTemplate && selectedOutlet
      ? `/api/audits/auditees?templateId=${selectedTemplate}&outletId=${selectedOutlet}`
      : null;
  const { data: auditees, isLoading: loadingAuditees } = useFetch<Auditee[]>(auditeesUrl);

  // /api/audits/outlets is already scoped to what the user is allowed to
  // audit (OWNER/ADMIN → all; everyone else → assigned outlets only).
  const visibleOutlets = outlets ?? [];
  const singleOutlet = visibleOutlets.length === 1;

  // If only one outlet is allowed, auto-select it so the disabled dropdown
  // represents a locked-in choice rather than a dead-end empty value.
  useEffect(() => {
    if (!showNew) return;
    if (singleOutlet && selectedOutlet !== visibleOutlets[0].id) {
      setSelectedOutlet(visibleOutlets[0].id);
    }
  }, [showNew, singleOutlet, visibleOutlets, selectedOutlet]);

  const inProgress = audits?.filter((a) => a.status === "IN_PROGRESS") ?? [];
  const completed = audits?.filter((a) => a.status === "COMPLETED") ?? [];

  const handleCreate = async () => {
    if (!selectedTemplate || !selectedOutlet) return;
    if (isStaffTemplate && !selectedAuditee) return;
    setCreating(true);
    try {
      const res = await fetch("/api/audits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate,
          outletId: selectedOutlet,
          auditeeId: isStaffTemplate ? selectedAuditee : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        mutate();
        setShowNew(false);
        setSelectedTemplate("");
        setSelectedOutlet("");
        setSelectedAuditee("");
        router.push(`/audit/${data.id}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const totalItems = (t: Template) => t.sections.reduce((s, sec) => s + sec._count.items, 0);

  return (
    <div className="px-4 pb-6 space-y-4">
      {/* Header */}
      <PageHeader
        title="Audit"
        description="Spot checks of your team and outlet."
        right={
          <Button onClick={() => setShowNew(!showNew)} className="min-h-11 bg-ink px-3.5 text-sm hover:bg-ink-hover">
            <Plus className="mr-1 h-4 w-4" /> New audit
          </Button>
        }
      />



      {/* New Audit Form */}
      {showNew && (
        <Card className="p-4 space-y-3 border-brand/30">
          <h3 className="text-sm font-semibold text-text">Start a new audit</h3>

          {/* Select Template */}
          <div>
            <label className="text-xs font-medium text-text-3 mb-1 block">Template</label>
            <select
              value={selectedTemplate}
              onChange={(e) => setSelectedTemplate(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
            >
              <option value="">Select template...</option>
              {templates?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({totalItems(t)} items)
                </option>
              ))}
            </select>
          </div>

          {/* Select Outlet — scoped server-side to the caller's assignments */}
          <div>
            <label className="text-xs font-medium text-text-3 mb-1 block">Outlet</label>
            {visibleOutlets.length === 0 ? (
              <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-text">
                You&apos;re not assigned to any outlet. Ask an admin to add you to an outlet before starting an audit.
              </p>
            ) : (
              <select
                value={selectedOutlet}
                onChange={(e) => { setSelectedOutlet(e.target.value); setSelectedAuditee(""); }}
                disabled={singleOutlet}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface disabled:bg-sunken/60"
              >
                <option value="">Select outlet...</option>
                {visibleOutlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Staff picker — only for STAFF templates */}
          {isStaffTemplate && selectedOutlet && (
            <div>
              <label className="text-xs font-medium text-text-3 mb-1 block">
                Staff to audit{(tpl?.jobRoleFilter ?? []).length > 0 ? ` (${(tpl?.jobRoleFilter ?? []).join(", ")})` : ""}
              </label>
              {loadingAuditees ? (
                <div className="flex items-center gap-2 text-xs text-text-3 py-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading staff…
                </div>
              ) : (auditees ?? []).length === 0 ? (
                <p className="rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn-text">
                  No staff at this outlet match{(tpl?.jobRoleFilter ?? []).length === 1 ? ` the role "${(tpl?.jobRoleFilter ?? [])[0]}"` : ` any of: ${(tpl?.jobRoleFilter ?? []).join(", ")}`}. Check HR profiles.
                </p>
              ) : (
                <select
                  value={selectedAuditee}
                  onChange={(e) => setSelectedAuditee(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface"
                >
                  <option value="">Select staff...</option>
                  {(auditees ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowNew(false)} className="text-xs flex-1">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!selectedTemplate || !selectedOutlet || (isStaffTemplate && !selectedAuditee) || creating}
              className="bg-ink hover:bg-ink-hover text-xs flex-1"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Start audit
            </Button>
          </div>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
        </div>
      )}

      {/* In Progress */}
      {inProgress.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-3">In progress</h2>
          <div className="space-y-2">
            {inProgress.map((audit) => (
              <Link key={audit.id} href={`/audit/${audit.id}`}>
                <Card className="px-3 py-2.5 transition-all active:bg-sunken/60">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-info-soft">
                      <Clock className="h-4 w-4 text-info-text" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-text truncate">{audit.template.name}</p>
                        {audit.isMine && (
                          <Badge className="text-[9px] bg-brand-soft text-brand-text border-none shrink-0">You</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-text-3 flex items-center gap-1 mt-0.5">
                        <Building2 className="h-2.5 w-2.5" />
                        <span className="truncate">{audit.auditor.name} · {audit.date} · {audit.completedItems}/{audit.totalItems}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right flex items-center gap-2">
                      <span className="text-sm font-bold text-text-2">{audit.progress}%</span>
                      <button
                        onClick={(e) => handleDelete(e, audit.id, audit.template.name)}
                        disabled={deletingId === audit.id}
                        aria-label="Delete audit"
                        className="rounded p-1 text-line-ctl hover:text-danger-text hover:bg-danger-soft disabled:opacity-50"
                      >
                        {deletingId === audit.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                      <ChevronRight className="h-4 w-4 text-line-ctl" />
                    </div>
                  </div>
                  <div className="mt-2 rounded-full bg-sunken h-1 overflow-hidden">
                    <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${audit.progress}%` }} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Completed (recent) */}
      {completed.length > 0 && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-3">Completed</h2>
          <div className="space-y-2">
            {completed.slice(0, 5).map((audit) => (
              <Link key={audit.id} href={`/audit/${audit.id}`}>
                <Card className="px-3 py-2.5 transition-all active:bg-sunken/60 opacity-80">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ok-soft">
                      <CheckCircle2 className="h-4 w-4 text-ok-text" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-text truncate">{audit.template.name}</p>
                        {audit.isMine && (
                          <Badge className="text-[9px] bg-brand-soft text-brand-text border-none shrink-0">You</Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-text-3 flex items-center gap-1 mt-0.5">
                        <Building2 className="h-2.5 w-2.5" />
                        <span className="truncate">{audit.auditor.name} · {audit.date}</span>
                      </p>
                    </div>
                    <div className="shrink-0 text-right flex items-center gap-2">
                      <Badge className={`text-[10px] ${(audit.overallScore ?? 0) >= 80 ? "bg-ok-soft text-ok-text" : (audit.overallScore ?? 0) >= 60 ? "bg-warn-soft text-warn-text" : "bg-danger-soft text-danger-text"}`}>
                        {audit.overallScore ?? 0}%
                      </Badge>
                      <button
                        onClick={(e) => handleDelete(e, audit.id, audit.template.name)}
                        disabled={deletingId === audit.id}
                        aria-label="Delete audit"
                        className="rounded p-1 text-line-ctl hover:text-danger-text hover:bg-danger-soft disabled:opacity-50"
                      >
                        {deletingId === audit.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                      <ChevronRight className="h-4 w-4 text-line-ctl" />
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!audits || audits.length === 0) && !showNew && (
        <Card className="px-4 py-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-line-ctl" />
          <p className="mt-3 text-sm text-text-3">No audits yet</p>
          <p className="mt-1 text-xs text-text-3">Tap &quot;New audit&quot; to start a spot check</p>
        </Card>
      )}

      {/* History link */}
      {completed.length > 5 && (
        <Link href="/audit/history" className="block text-center text-xs text-brand-text py-2">
          View all history →
        </Link>
      )}
    </div>
  );
}
