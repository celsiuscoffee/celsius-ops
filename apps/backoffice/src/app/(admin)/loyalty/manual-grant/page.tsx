"use client";

import { useEffect, useState } from "react";
import { Search, Check } from "lucide-react";

interface VoucherTemplate { id: string; title: string; category: string }
interface Member { id: string; name: string | null; phone: string }

const BRAND_ID = "brand-celsius";

export default function ManualGrantPage() {
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [matches, setMatches] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [granting, setGranting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/loyalty/voucher-templates?brand_id=${BRAND_ID}`, { credentials: "include" });
        setTemplates(await r.json());
      } catch { /* ignore */ }
    })();
  }, []);

  async function searchMembers() {
    if (memberQuery.trim().length < 3) {
      setMatches([]);
      return;
    }
    setLoading(true);
    try {
      // Re-use existing members lookup endpoint.
      const r = await fetch(`/api/loyalty/members?brand_id=${BRAND_ID}&search=${encodeURIComponent(memberQuery.trim())}&limit=8`, { credentials: "include" });
      const json = await r.json();
      const rows = Array.isArray(json) ? json : json?.members;
      setMatches(Array.isArray(rows) ? rows.slice(0, 8) : []);
    } catch { setMatches([]); }
    finally { setLoading(false); }
  }

  async function grant() {
    if (!templateId || !selectedMember) return;
    setGranting(true); setResult(null);
    try {
      const res = await fetch(`/api/loyalty/manual-grant`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_id: BRAND_ID,
          member_id: selectedMember.id,
          template_id: templateId,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setResult({ ok: false, message: j.error ?? "Grant failed" });
        return;
      }
      const v = await res.json();
      setResult({ ok: true, message: `Granted "${v.title}" to ${selectedMember.name ?? selectedMember.phone}` });
      // Reset form for next grant.
      setTemplateId("");
      setNote("");
      setSelectedMember(null);
      setMemberQuery("");
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Network error" });
    } finally {
      setGranting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl px-4 pt-6 pb-10 md:px-8">
      <div>
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Manual grant</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-text-2">
          Give one customer a voucher to put something right: a refund, a complaint, a thank-you.
          It is logged as a manual grant.
        </p>
      </div>

      <div className="space-y-5 rounded-card border border-line bg-surface p-5 md:p-6">
        {/* Member search */}
        <div>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-text-2">
              Customer
            </span>
            {selectedMember ? (
              <div className="flex items-center justify-between rounded-lg border p-3 bg-sunken">
                <div>
                  <div className="font-medium">{selectedMember.name ?? "(no name)"}</div>
                  <div className="text-xs text-text-2">{selectedMember.phone}</div>
                </div>
                <button
                  onClick={() => { setSelectedMember(null); setMemberQuery(""); setMatches([]); }}
                  className="text-xs text-text-2 hover:text-text"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-2" />
                <input
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") searchMembers(); }}
                  className="h-11 w-full rounded-ctl border border-line bg-surface pl-10 pr-20 text-sm text-text"
                  placeholder="Phone, name, or member id (min 3 chars)"
                />
                <button
                  onClick={searchMembers}
                  className="absolute right-1.5 top-1/2 h-8 -translate-y-1/2 rounded-ctl bg-ink px-3 text-xs font-medium text-on-ink"
                >
                  Search
                </button>
              </div>
            )}
            {loading && <div className="text-xs text-text-2 mt-2">Searching…</div>}
            {!selectedMember && matches.length > 0 && (
              <div className="mt-2 max-h-60 divide-y divide-line overflow-y-auto rounded-ctl border border-line">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setSelectedMember(m); setMatches([]); }}
                    className="w-full px-3 py-2.5 text-left hover:bg-sunken flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium text-sm">{m.name ?? "(no name)"}</div>
                      <div className="text-xs text-text-2">{m.phone}</div>
                    </div>
                    <span className="text-xs text-text-2">{m.id.slice(0, 8)}…</span>
                  </button>
                ))}
              </div>
            )}
          </label>
        </div>

        {/* Template */}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-text-2">
            Voucher to grant
          </span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="h-11 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text"
          >
            <option value="">Pick a voucher…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.title} · {t.category}</option>
            ))}
          </select>
        </label>

        {/* Note */}
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-text-2">
            Internal note (optional)
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-11 w-full rounded-ctl border border-line bg-surface px-3 text-sm text-text"
            placeholder="e.g. Refund for spilled latte at Putrajaya 12 May"
          />
          <p className="text-xs text-text-2 mt-1.5">
            Appended to the voucher description so the customer sees the context.
          </p>
        </label>

        {/* Action */}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button
            onClick={grant}
            disabled={!selectedMember || !templateId || granting}
            className="inline-flex h-10 items-center gap-2 rounded-ctl bg-ink px-4 text-sm font-medium text-on-ink hover:bg-ink-hover disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {granting ? "Granting…" : "Grant voucher"}
          </button>
          {result && (
            <span className={`text-xs ${result.ok ? "text-ok-text" : "text-danger-text"}`}>
              {result.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
