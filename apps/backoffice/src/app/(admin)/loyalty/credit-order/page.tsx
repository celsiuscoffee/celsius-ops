"use client";

import { useState } from "react";
import { Coins, Search, Check, Receipt } from "lucide-react";

interface Member { id: string; name: string | null; phone: string }

interface OrderPreview {
  order: {
    id: string;
    order_number: string | null;
    total_rm: number;
    sst_rm: number;
    outlet_id: string | null;
    status: string | null;
    created_at: string | null;
  };
  base_points: number;
  eligible: boolean;
  reason: string | null;
}

const BRAND_ID = "brand-celsius";

export default function CreditOrderPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [looking, setLooking] = useState(false);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [memberQuery, setMemberQuery] = useState("");
  const [matches, setMatches] = useState<Member[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  const [reason, setReason] = useState("");
  const [awarding, setAwarding] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function resetAll() {
    setPreview(null);
    setLookupError(null);
    setSelectedMember(null);
    setMemberQuery("");
    setMatches([]);
    setReason("");
  }

  async function lookupOrder() {
    const n = orderNumber.trim();
    if (!n) return;
    setLooking(true);
    setResult(null);
    resetAll();
    try {
      const r = await fetch(`/api/pos/loyalty/credit-order?order_number=${encodeURIComponent(n)}`, {
        credentials: "include",
      });
      const j = await r.json();
      if (!r.ok) {
        setLookupError(j.error ?? "Lookup failed");
        return;
      }
      setPreview(j as OrderPreview);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLooking(false);
    }
  }

  async function searchMembers() {
    if (memberQuery.trim().length < 3) {
      setMatches([]);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(
        `/api/loyalty/members?brand_id=${BRAND_ID}&search=${encodeURIComponent(memberQuery.trim())}&limit=8`,
        { credentials: "include" },
      );
      const json = await r.json();
      const rows = Array.isArray(json) ? json : json?.members;
      setMatches(Array.isArray(rows) ? rows.slice(0, 8) : []);
    } catch {
      setMatches([]);
    } finally {
      setSearching(false);
    }
  }

  async function award() {
    if (!preview?.eligible || !selectedMember) return;
    setAwarding(true);
    setResult(null);
    try {
      const res = await fetch(`/api/pos/loyalty/credit-order`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: preview.order.order_number,
          member_id: selectedMember.id,
          reason: reason.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: j.error ?? "Award failed" });
        return;
      }
      setResult({
        ok: true,
        message: `Awarded ${j.points_awarded} Beans to ${selectedMember.name ?? selectedMember.phone} for order ${j.order_number}.`,
      });
      // Reset for the next credit.
      setOrderNumber("");
      resetAll();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Network error" });
    } finally {
      setAwarding(false);
    }
  }

  const o = preview?.order;
  const finalPoints = preview ? preview.base_points : 0;

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Coins className="w-6 h-6" />
          Credit a Past Order
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Award loyalty Beans for a completed in-store order to a customer who
          forgot to give their phone at the till. Points are computed from the
          actual order total — you can&apos;t enter a number. Orders can be
          credited up to 3 days after the sale. Logged in Points Log with your
          name.
        </p>
      </div>

      {/* Step 1 — order lookup */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground block mb-1.5 uppercase tracking-wide">
            Order / receipt number
          </span>
          <div className="relative">
            <Receipt className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") lookupOrder(); }}
              className="w-full border rounded-lg pl-10 pr-3 py-2 bg-background"
              placeholder="e.g. CC-PJ-0123"
            />
            <button
              onClick={lookupOrder}
              disabled={looking || !orderNumber.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-3 py-1.5 rounded bg-foreground text-background disabled:opacity-50"
            >
              {looking ? "Looking…" : "Look up"}
            </button>
          </div>
        </label>
        {lookupError && <p className="text-xs text-rose-500">{lookupError}</p>}

        {o && (
          <div className="rounded-lg border p-4 bg-foreground/[0.02] space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Order</span>
              <span className="font-medium">{o.order_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span>{o.created_at ? new Date(o.created_at).toLocaleString() : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount</span>
              <span>RM {o.total_rm.toFixed(2)}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Beans to award</span>
              <span className="font-semibold">
                {finalPoints} <span className="text-xs font-normal text-muted-foreground">(× member tier on confirm)</span>
              </span>
            </div>
            {!preview?.eligible && (
              <p className="text-xs text-rose-500 border-t pt-2">{preview?.reason}</p>
            )}
          </div>
        )}
      </div>

      {/* Step 2 — member + confirm (only when an eligible order is loaded) */}
      {preview?.eligible && (
        <div className="rounded-xl border bg-card p-6 space-y-5">
          <div>
            <span className="text-xs font-medium text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Customer
            </span>
            {selectedMember ? (
              <div className="flex items-center justify-between rounded-lg border p-3 bg-foreground/[0.02]">
                <div>
                  <div className="font-medium">{selectedMember.name ?? "(no name)"}</div>
                  <div className="text-xs text-muted-foreground">{selectedMember.phone}</div>
                </div>
                <button
                  onClick={() => { setSelectedMember(null); setMemberQuery(""); setMatches([]); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchMembers(); }}
                  className="w-full border rounded-lg pl-10 pr-3 py-2 bg-background"
                  placeholder="Phone, name, or member id (min 3 chars)"
                />
                <button
                  onClick={searchMembers}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs px-2 py-1 rounded bg-foreground text-background"
                >
                  Search
                </button>
              </div>
            )}
            {searching && <div className="text-xs text-muted-foreground mt-2">Searching…</div>}
            {!selectedMember && matches.length > 0 && (
              <div className="mt-2 border rounded-lg divide-y max-h-60 overflow-y-auto">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedMember(m); setMatches([]); }}
                    className="w-full px-3 py-2.5 text-left hover:bg-muted flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-sm">{m.name ?? "(no name)"}</div>
                      <div className="text-xs text-muted-foreground">{m.phone}</div>
                    </div>
                    <span className="text-xs text-muted-foreground">{m.id.slice(0, 8)}…</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-muted-foreground block mb-1.5 uppercase tracking-wide">
              Reason (optional)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 bg-background"
              placeholder="e.g. Customer forgot phone — receipt shown at Putrajaya"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Stored in the points ledger alongside your name for audit.
            </p>
          </label>

          <div className="flex items-center gap-3 pt-2 border-t">
            <button
              onClick={award}
              disabled={!selectedMember || awarding}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {awarding ? "Awarding…" : "Award points"}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className={`text-sm ${result.ok ? "text-emerald-500" : "text-rose-500"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
