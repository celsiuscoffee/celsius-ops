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
  RefreshCw,
} from "lucide-react";

type Case = {
  id: string;
  source: "google" | "qr";
  reviewId: string;
  outletId: string;
  outletName: string;
  reviewerName: string | null;
  phone: string | null;
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
  { key: "needs_action", label: "Needs action", match: (s) => s === "pending" || s === "open" },
  { key: "awaiting", label: "Awaiting customer", match: (s) => s === "approved" },
  { key: "compensated", label: "Compensated", match: (s) => s === "compensated" },
  { key: "resolved", label: "Resolved", match: (s) => s === "resolved" },
  { key: "closed", label: "Closed", match: (s) => s === "rejected" || s === "expired" || s === "dismissed" },
  { key: "all", label: "All", match: () => true },
];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Needs reply", cls: "bg-warn-soft text-warn-text" },
  open: { label: "New feedback", cls: "bg-warn-soft text-warn-text" },
  approved: { label: "Awaiting customer", cls: "bg-info-soft text-info-text" },
  compensated: { label: "Compensated", cls: "bg-ok-soft text-ok-text" },
  resolved: { label: "Resolved", cls: "bg-line text-text-2" },
  rejected: { label: "Rejected", cls: "bg-line text-text-2" },
  expired: { label: "Expired", cls: "bg-line text-text-2" },
  dismissed: { label: "Dismissed", cls: "bg-line text-text-2" },
};

function StarRow({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= rating ? "fill-warn text-warn-text" : "text-text-3"}`}
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
  const [filter, setFilter] = useState("needs_action");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [comp, setComp] = useState<Record<string, { phone: string; name: string }>>({});
  const [ctx, setCtx] = useState<Record<string, string>>({});
  const [regen, setRegen] = useState<Record<string, boolean>>({});

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
        body: JSON.stringify({ id: c.id, source: c.source, action, ...extra }),
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

  const regenerate = async (c: Case) => {
    setRegen((r) => ({ ...r, [c.id]: true }));
    try {
      const res = await fetch("/api/reviews/negatives/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: c.id, context: ctx[c.id] ?? "" }),
      });
      const d = await res.json();
      if (res.ok && d.draftReply) setEdits((m) => ({ ...m, [c.id]: d.draftReply }));
      else alert(d.error || "Could not regenerate");
    } finally {
      setRegen((r) => ({ ...r, [c.id]: false }));
    }
  };

  const counts = (key: string) =>
    (cases ?? []).filter((c) => FILTERS.find((f) => f.key === key)!.match(c.status)).length;

  const visible = (cases ?? []).filter((c) => FILTERS.find((f) => f.key === filter)!.match(c.status));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/reviews" className="mb-1 flex items-center gap-1 text-xs text-text-2 hover:text-text">
            <ArrowLeft className="h-3.5 w-3.5" /> Reviews
          </Link>
          <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Feedback</h1>
          <p className="mt-0.5 text-sm text-text-2">Every negative Google review and QR feedback, worked through to a compensated customer.</p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={syncing}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-on-ink hover:bg-ink/90 disabled:opacity-50"
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
                ? "bg-ink text-on-ink"
                : "border border-line bg-surface text-text-2 hover:bg-sunken"
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
            <Loader2 className="h-6 w-6 animate-spin text-text-2" />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface p-10 text-center">
            <Check className="mx-auto h-10 w-10 text-text-2/30" />
            <p className="mt-3 text-sm text-text-2">Nothing here right now.</p>
          </div>
        ) : (
          visible.map((c) => {
            const badge = STATUS_BADGE[c.status] ?? { label: c.status, cls: "bg-line text-text-2" };
            const isBusy = busy[c.id];
            const draftVal = edits[c.id] ?? c.draftReply;
            const compForm = comp[c.id];
            return (
              <div key={c.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <StarRow rating={c.rating} />
                      <span className="text-sm font-medium text-text">{c.reviewerName || "Anonymous"}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-2">{c.outletName} · {timeAgo(c.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-sunken px-2 py-1 text-[11px] font-medium text-text-2">{c.source === "qr" ? "QR" : "Google"}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                  </div>
                </div>

                {c.comment && (
                  <p className="mt-2 rounded-lg bg-sunken p-2 text-sm text-text">{c.comment}</p>
                )}

                {/* NEEDS REPLY — editable draft + approve/reject */}
                {c.status === "pending" && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs font-medium text-text-2">AI draft reply (edit before approving)</p>
                    <textarea
                      value={draftVal}
                      onChange={(e) => setEdits((m) => ({ ...m, [c.id]: e.target.value }))}
                      rows={3}
                      className="w-full rounded-lg border border-line bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                    />
                    <p className="mt-1 text-[11px] text-text-2">A recovery link is added automatically when you approve.</p>

                    {/* Approver context → regenerate a more honest, specific reply */}
                    <div className="mt-2 rounded-lg border border-dashed border-line p-2">
                      <p className="mb-1 text-xs font-medium text-text-2">What actually happened? (optional — gives a better, less generic reply)</p>
                      <textarea
                        value={ctx[c.id] ?? ""}
                        onChange={(e) => setCtx((m) => ({ ...m, [c.id]: e.target.value }))}
                        rows={2}
                        placeholder="e.g. sink was broken so drinks went out in takeaway cups; repair booked for Friday"
                        className="w-full rounded-lg border border-line bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                      />
                      <button
                        onClick={() => regenerate(c)}
                        disabled={regen[c.id]}
                        className="mt-1.5 flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-text hover:bg-sunken disabled:opacity-50"
                      >
                        {regen[c.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Regenerate draft
                      </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => act(c, "approve", { reply: draftVal })}
                        disabled={isBusy || !draftVal.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-on-ink hover:bg-ink/90 disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Approve &amp; Post
                      </button>
                      <button
                        onClick={() => act(c, "reject")}
                        disabled={isBusy}
                        className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-text-2 hover:bg-sunken disabled:opacity-50"
                      >
                        <X className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  </div>
                )}

                {/* AWAITING CUSTOMER — code + compensate/resolve/expire */}
                {c.status === "approved" && (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-text">
                      Reply posted. Recovery code <span className="font-mono font-semibold">{c.recoveryCode}</span> — waiting for the customer to claim their voucher.
                    </div>
                    {compForm ? (
                      <div className="rounded-lg border border-line p-2">
                        <p className="mb-1.5 text-xs font-medium text-text-2">Got their number directly? Compensate now.</p>
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={compForm.phone}
                            onChange={(e) => setComp((m) => ({ ...m, [c.id]: { ...compForm, phone: e.target.value } }))}
                            placeholder="01XXXXXXXX"
                            inputMode="tel"
                            className="w-40 rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                          />
                          <input
                            value={compForm.name}
                            onChange={(e) => setComp((m) => ({ ...m, [c.id]: { ...compForm, name: e.target.value } }))}
                            placeholder="Name (optional)"
                            className="w-36 rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                          />
                          <button
                            onClick={() => act(c, "compensate", { phone: compForm.phone, name: compForm.name })}
                            disabled={isBusy || !compForm.phone.trim()}
                            className="flex items-center gap-1.5 rounded-lg bg-ok px-3 py-1.5 text-sm font-medium text-on-ink hover:bg-ok disabled:opacity-50"
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
                          className="flex items-center gap-1.5 rounded-lg border border-ok/30 bg-surface px-3 py-1.5 text-sm font-medium text-ok-text hover:bg-ok-soft disabled:opacity-50"
                        >
                          <Phone className="h-4 w-4" /> Compensate manually
                        </button>
                        <button
                          onClick={() => act(c, "resolve")}
                          disabled={isBusy}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-text-2 hover:bg-sunken disabled:opacity-50"
                        >
                          Mark resolved
                        </button>
                        <button
                          onClick={() => act(c, "expire")}
                          disabled={isBusy}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-text-2 hover:bg-sunken disabled:opacity-50"
                        >
                          No response
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* QR FEEDBACK (open) — we already have their phone; compensate directly */}
                {c.status === "open" && (
                  <div className="mt-3 space-y-2">
                    {c.phone ? (
                      <p className="text-xs text-text-2">Contact: <span className="font-medium text-text">{c.phone}</span></p>
                    ) : (
                      <p className="text-xs text-warn-text">No phone on this feedback — enter one to compensate.</p>
                    )}
                    {compForm ? (
                      <div className="rounded-lg border border-line p-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            value={compForm.phone}
                            onChange={(e) => setComp((m) => ({ ...m, [c.id]: { ...compForm, phone: e.target.value } }))}
                            placeholder="01XXXXXXXX"
                            inputMode="tel"
                            className="w-40 rounded-lg border border-line px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
                          />
                          <button
                            onClick={() => act(c, "compensate", { phone: compForm.phone, name: compForm.name })}
                            disabled={isBusy || !compForm.phone.trim()}
                            className="flex items-center gap-1.5 rounded-lg bg-ok px-3 py-1.5 text-sm font-medium text-on-ink hover:bg-ok disabled:opacity-50"
                          >
                            <Gift className="h-4 w-4" /> Issue voucher
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => (c.phone ? act(c, "compensate", {}) : setComp((m) => ({ ...m, [c.id]: { phone: "", name: c.reviewerName ?? "" } })))}
                          disabled={isBusy}
                          className="flex items-center gap-1.5 rounded-lg bg-ok px-3 py-2 text-sm font-medium text-on-ink hover:bg-ok disabled:opacity-50"
                        >
                          <Gift className="h-4 w-4" /> Compensate (free coffee)
                        </button>
                        <button
                          onClick={() => act(c, "dismiss")}
                          disabled={isBusy}
                          className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-text-2 hover:bg-sunken disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* COMPENSATED — show capture + resolve */}
                {c.status === "compensated" && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-1.5 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok-text">
                      <Gift className="h-4 w-4" /> Customer captured + free coffee issued{c.claimedAt ? ` · ${timeAgo(c.claimedAt)}` : ""}.
                    </div>
                    <button
                      onClick={() => act(c, "resolve")}
                      disabled={isBusy}
                      className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-on-ink hover:bg-ink/90 disabled:opacity-50"
                    >
                      Mark resolved
                    </button>
                  </div>
                )}

                {/* CLOSED states */}
                {(c.status === "resolved" || c.status === "rejected" || c.status === "expired" || c.status === "dismissed") && c.resolvedAt && (
                  <p className="mt-2 text-xs text-text-2">
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
