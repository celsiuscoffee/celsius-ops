"use client";

import { useEffect, useState } from "react";
import { HandCoins, Search, Check } from "lucide-react";

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
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <HandCoins className="w-6 h-6" />
          Manual Voucher Grant
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Grant a voucher directly to a customer for refunds, complaint resolutions,
          makeup gestures, or internal rewards. Issues from any active voucher template.
          Logged under source <code className="bg-muted px-1 rounded">manual</code>.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-6 space-y-5">
        {/* Member search */}
        <div>
          <label className="block">
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
            {loading && <div className="text-xs text-muted-foreground mt-2">Searching…</div>}
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
          </label>
        </div>

        {/* Template */}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground block mb-1.5 uppercase tracking-wide">
            Voucher to grant
          </span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-full border rounded-lg px-3 py-2.5 bg-background"
          >
            <option value="">— select template —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.title} · {t.category}</option>
            ))}
          </select>
        </label>

        {/* Note */}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground block mb-1.5 uppercase tracking-wide">
            Internal note (optional)
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 bg-background"
            placeholder="e.g. Refund for spilled latte at Putrajaya 12 May"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Appended to the voucher description so the customer sees the context.
          </p>
        </label>

        {/* Action */}
        <div className="flex items-center gap-3 pt-2 border-t">
          <button
            onClick={grant}
            disabled={!selectedMember || !templateId || granting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {granting ? "Granting…" : "Grant voucher"}
          </button>
          {result && (
            <span className={`text-xs ${result.ok ? "text-emerald-500" : "text-rose-500"}`}>
              {result.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
