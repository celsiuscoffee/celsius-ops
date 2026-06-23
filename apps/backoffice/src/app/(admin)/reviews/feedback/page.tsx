"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Loader2,
  Star,
  Check,
  X,
  Send,
  Sparkles,
  ArrowLeft,
  Gift,
  Phone,
} from "lucide-react";

type Case = {
  id: string;
  reviewId: string;
  outletId: string;
  outletName: string;
  reviewerName: string | null;
  rating: number;
  comment: string | null;
  draftReply: string;
  finalReply: string | null;
  status: string;
  recoveryCode: string | null;
  claimedAt: string | null;
  recoveryMemberId: string | null;
  recoveryRewardId: string | null;
  redeemedAt: string | null;
  resolvedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
};

const FILTERS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "needs_reply", label: "Needs reply", match: (s) => s === "pending" },
  { key: "awaiting", label: "Awaiting customer", match: (s) => s === "approved" },
  { key: "compensated", label: "Compensated", match: (s) => s === "compensated" },
  { key: "resolved", label: "Resolved", match: (s) => s === "resolved" },
  { key: "closed", label: "Closed", match: (s) => s === "rejected" || s === "expired" },
  { key: "all", label: "All", match: () => true },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Needs reply", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "Awaiting customer", cls: "bg-blue-100 text-blue-800" },
  compensated: { label: "Compensated", cls: "bg-emerald-100 text-emerald-800" },
  resolved: { label: "Resolved", cls: "bg-neutral-200 text-neutral-700" },
  rejected: { label: "Rejected", cls: "bg-neutral-200 text-neutral-500" },
  expired: { label: "Expired", cls: "bg-neutral-200 text-neutral-500" },
};

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`}
        />
      ))}
    </div>
  );
}

function timeAgo(d: string | null): string {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs > 0) return `${hrs}h ago`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m ago`;
}

export default function FeedbackManagementPage() {
  const [cases, setCases] = useState<Case[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("needs_reply");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [comp, setComp] = useState<Record<string, { phone: string; name: string }>>({});

  const load = useCallback(async (sync: boolean) => {
    if (sync) setSyncing(true);
    try {
      const res = await fetch(`/api/reviews/negatives?scope=all${sync ? "&sync=1" : ""}`);
      const data = await res.json();
      setCases(data.cases ?? []);
    } catch {
      setCases([]);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const act = async (
    c: Case,
    action: string,
    extra?: Record<string, unknown>,
  ) => {
    setBusy((b) => ({ ...b, [c.id]: true }));
    try {
      const res = await fetch("/api/reviews/negatives/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, action, ...extra }),
      });
      if (res.ok) {
        await load(false);
        setComp((m) => {
          const n = { ...m };
          delete n[c.id];
          return n;
        });
      } else {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Action failed");
      }
    } finally {
      setBusy((b) => ({ ...b, [c.id]: false }));
    }
  };

  const counts = (key: string) =>
    (cases ?? []).filter((c) => FILTERS.find((f) => f.key === key)!.match(c.status)).length;

  const visible = (cases ?? []).filter((c) => FILTERS.find((f) => f.key === filter)!.match(c.status));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/reviews" className="mb-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Reviews
          </Link>
          <h1 className="font-heading text-2xl font-bold text-foreground">Feedback Management</h1>
          <p className="text-sm text-muted-foreground">Every negative review, worked through to a compensated customer.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={syncing}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-terracotta px-3 py-2 text-sm font-medium text-white hover:bg-terracotta/90 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Check Google for new
        </button>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? "bg-brand-dark text-white"
                : "border border-border bg-white text-muted-foreground hover:bg-muted"
            }`}
          >
            {f.label} ({counts(f.key)})
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 space-y-3">
        {cases === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-white p-10 text-center">
            <Check className="mx-auto h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm text-muted-foreground">Nothing here right now.</p>
          </div>
        ) : (
          visible.map((c) => {
            const badge = STATUS_BADGE[c.status] ?? { label: c.status, cls: "bg-neutral-200 text-neutral-600" };
            const isBusy = busy[c.id];
            const draftVal = edits[c.id] ?? c.draftReply;
            const compForm = comp[c.id];
            return (
              <div key={c.id} className="rounded-xl border border-border bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <StarRow rating={c.rating} />
                      <span className="text-sm font-medium text-foreground">{c.reviewerName || "Anonymous"}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.outletName} · {timeAgo(c.createdAt)}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                </div>

                {c.comment && (
                  <p className="mt-2 rounded-lg bg-muted/50 p-2 text-sm text-foreground">{c.comment}</p>
                )}

                {/* NEEDS REPLY — editable draft + approve/reject */}
                {c.status === "pending" && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">AI draft reply (edit before approving)</p>
                    <textarea
                      value={draftVal}
                      onChange={(e) => setEdits((m) => ({ ...m, [c.id]: e.target.value }))}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-white p-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">A recovery link is added automatically when you approve.</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => act(c, "approve", { reply: draftVal })}
                        disabled={isBusy || !draftVal.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Approve &amp; Post
                      </button>
                      <button
                        onClick={() => act(c, "reject")}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* AWAITING CUSTOMER — code + compensate/resolve/expire */}
                {c.status === "approved" && (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                      Reply posted. Recovery code <span className="font-mono font-semibold">{c.recoveryCode}</span> — waiting for the customer to claim their voucher.
                    </div>
                    {compForm ? (
                      <div className="rounded-lg border border-border p-2">
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Got their number directly? Compensate now.</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={compForm.phone}
                            onChange={(e) => setComp((m) => ({ ...m, [c.id]: { ...compForm, phone: e.target.value } }))}
                            placeholder="01XXXXXXXX"
                            inputMode="tel"
                            className="w-40 rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                          />
                          <input
                            value={compForm.name}
                            onChange={(e) => setComp((m) => ({ ...m, [c.id]: { ...compForm, name: e.target.value } }))}
                            placeholder="Name (optional)"
                            className="w-36 rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                          />
                          <button
                            onClick={() => act(c, "compensate", { phone: compForm.phone, name: compForm.name })}
                            disabled={isBusy || !compForm.phone.trim()}
                            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <Gift className="h-4 w-4" /> Issue voucher
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => setComp((m) => ({ ...m, [c.id]: { phone: "", name: c.reviewerName ?? "" } }))}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                        >
                          <Phone className="h-4 w-4" /> Compensate manually
                        </button>
                        <button
                          onClick={() => act(c, "resolve")}
                          disabled={isBusy}
                          className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          Mark resolved
                        </button>
                        <button
                          onClick={() => act(c, "expire")}
                          disabled={isBusy}
                          className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                        >
                          No response
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* COMPENSATED — show capture + resolve */}
                {c.status === "compensated" && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                      <Gift className="h-4 w-4" /> Customer captured + free coffee issued{c.claimedAt ? ` · ${timeAgo(c.claimedAt)}` : ""}.
                    </div>
                    <button
                      onClick={() => act(c, "resolve")}
                      disabled={isBusy}
                      className="rounded-lg bg-brand-dark px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark/90 disabled:opacity-50"
                    >
                      Mark resolved
                    </button>
                  </div>
                )}

                {/* CLOSED states */}
                {(c.status === "resolved" || c.status === "rejected" || c.status === "expired") && c.resolvedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {badge.label}{c.decidedBy ? ` by ${c.decidedBy}` : ""} · {timeAgo(c.resolvedAt)}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
