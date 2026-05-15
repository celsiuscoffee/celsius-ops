"use client";

import { useState, useEffect } from "react";
import { Gift, Plus, Pencil, Trash2, X, Send } from "lucide-react";

interface Claimable {
  id: string;
  brand_id: string;
  title: string;
  description: string;
  voucher_template_id: string;
  member_ids: string[];
  audience_label: string | null;
  starts_at: string;
  ends_at: string | null;
  max_claims: number | null;
  total_claimed: number;
  is_active: boolean;
}

interface VoucherTemplate { id: string; title: string; category: string }

const BRAND_ID = "brand-celsius";

export default function AdminClaimablesPage() {
  const [items, setItems] = useState<Claimable[]>([]);
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Claimable | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/loyalty/admin-claimables?brand_id=${BRAND_ID}`, { credentials: "include" }),
        fetch(`/api/loyalty/voucher-templates?brand_id=${BRAND_ID}`, { credentials: "include" }),
      ]);
      setItems(await r1.json());
      setTemplates(await r2.json());
    } catch { setItems([]); setTemplates([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(c: Claimable) {
    await fetch(`/api/loyalty/admin-claimables`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: c.id, is_active: !c.is_active }),
    });
    await load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this claimable? Members who already claimed it keep their voucher.")) return;
    await fetch(`/api/loyalty/admin-claimables?id=${id}`, { method: "DELETE", credentials: "include" });
    await load();
  }

  async function broadcast(c: Claimable) {
    const audienceCopy = c.member_ids.length === 0
      ? "ALL brand members"
      : `${c.member_ids.length} member(s)`;
    if (!confirm(`Send a push notification to ${audienceCopy} about "${c.title}"?`)) return;
    const res = await fetch(`/api/loyalty/admin-claimables/${c.id}/broadcast`, {
      method: "POST",
      credentials: "include",
    });
    const body = await res.json();
    if (!res.ok) {
      alert(`Push failed: ${body.error ?? "unknown"}`);
      return;
    }
    alert(`Push sent: ${body.sent} delivered, ${body.failed} failed (${body.recipients} recipients).`);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Gift className="w-6 h-6" />
            Admin Claimables
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            One-tap claim offers pushed from the team — welcome drinks, comeback promos, segmented
            give-aways. Each one references a Voucher Template; tapping Claim issues the voucher
            into the customer&apos;s wallet.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Claimable
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed rounded-xl">
          <Gift className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">No claimables yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Push a welcome offer or a segmented promo. Customers see it under
            <em> Rewards → Vouchers → Claim now</em>.
          </p>
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium">
            <Plus className="w-4 h-4" /> Create first claimable
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => {
            const tpl = templates.find((t) => t.id === c.voucher_template_id);
            return (
              <div key={c.id} className="rounded-xl border bg-card p-4 space-y-3">
                <div>
                  <h3 className="font-semibold">{c.title}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{c.description}</p>
                </div>
                <div className="text-xs text-muted-foreground border-t pt-2 space-y-0.5">
                  <div>Issues: <strong className="text-foreground">{tpl?.title ?? "—"}</strong></div>
                  <div>Audience: {c.member_ids.length === 0 ? "Everyone" : `${c.member_ids.length} members`}{c.audience_label ? ` · ${c.audience_label}` : ""}</div>
                  {c.ends_at && <div>Ends: {new Date(c.ends_at).toLocaleDateString()}</div>}
                  <div>Claimed: <strong className="text-foreground">{c.total_claimed}</strong>{c.max_claims ? ` / ${c.max_claims}` : ""}</div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t">
                  <button
                    onClick={() => toggleActive(c)}
                    className={`text-xs font-medium px-2.5 py-1 rounded ${
                      c.is_active ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {c.is_active ? "● Active" : "○ Paused"}
                  </button>
                  <div className="flex gap-1">
                    <button onClick={() => broadcast(c)} className="p-1.5 hover:bg-emerald-500/10 text-emerald-600 rounded" title="Send push to audience">
                      <Send className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditing(c)} className="p-1.5 hover:bg-muted rounded">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => remove(c.id)} className="p-1.5 hover:bg-rose-500/10 text-rose-500 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(editing || creating) && (
        <Modal
          claimable={editing}
          templates={templates}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={async () => { setEditing(null); setCreating(false); await load(); }}
        />
      )}
    </div>
  );
}

function Modal({
  claimable, templates, onClose, onSaved,
}: { claimable: Claimable | null; templates: VoucherTemplate[]; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(claimable?.title ?? "");
  const [description, setDescription] = useState(claimable?.description ?? "");
  const [templateId, setTemplateId] = useState(claimable?.voucher_template_id ?? "");
  const [audienceLabel, setAudienceLabel] = useState(claimable?.audience_label ?? "");
  const [memberIdsText, setMemberIdsText] = useState((claimable?.member_ids ?? []).join("\n"));
  const [endsAt, setEndsAt] = useState(claimable?.ends_at ? claimable.ends_at.slice(0, 16) : "");
  const [maxClaims, setMaxClaims] = useState<number | "">(claimable?.max_claims ?? "");
  const [isActive, setIsActive] = useState(claimable?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const memberIds = memberIdsText
        .split(/[\n,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = {
        brand_id: BRAND_ID,
        title, description,
        voucher_template_id: templateId,
        member_ids: memberIds,
        audience_label: audienceLabel || null,
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        max_claims: maxClaims === "" ? null : Number(maxClaims),
        is_active: isActive,
      };
      const res = claimable
        ? await fetch(`/api/loyalty/admin-claimables`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ id: claimable.id, ...payload }),
          })
        : await fetch(`/api/loyalty/admin-claimables`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify(payload),
          });
      if (!res.ok) { const j = await res.json(); setError(j.error ?? "Save failed"); return; }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl w-full max-w-lg md:max-w-3xl my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold">{claimable ? "Edit Claimable" : "New Claimable"}</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground block mb-1.5">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Welcome Drink" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground block mb-1.5">Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="One-time offer, claim today" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground block mb-1.5">Issues this voucher</span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background">
              <option value="">— select template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.category}</option>)}
            </select>
          </label>
          <div className="border rounded-lg p-3 space-y-3 bg-foreground/[0.02]">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audience</div>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground block mb-1.5">Audience label (display)</span>
              <input value={audienceLabel} onChange={(e) => setAudienceLabel(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Welcome cohort" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground block mb-1.5">Member IDs (one per line; blank = everyone)</span>
              <textarea
                value={memberIdsText}
                onChange={(e) => setMemberIdsText(e.target.value)}
                rows={4}
                className="w-full border rounded-lg px-3 py-2 bg-background font-mono text-xs"
                placeholder="uuid-1&#10;uuid-2&#10;uuid-3"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground block mb-1.5">Ends (optional)</span>
              <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full border rounded-lg px-3 py-2 bg-background" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground block mb-1.5">Max claims (optional)</span>
              <input type="number" min={1} value={maxClaims} onChange={(e) => setMaxClaims(e.target.value === "" ? "" : Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 bg-background" placeholder="Unlimited" />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            <span className="text-sm">Active</span>
          </label>
          {error && <div className="text-sm text-rose-500">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button onClick={onClose} className="px-4 py-2 rounded-lg hover:bg-muted text-sm">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50">
            {saving ? "Saving…" : claimable ? "Save changes" : "Create claimable"}
          </button>
        </div>
      </div>
    </div>
  );
}
