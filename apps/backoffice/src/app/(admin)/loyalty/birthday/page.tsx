"use client";

import { useEffect, useState } from "react";
import { Cake, Save } from "lucide-react";

interface VoucherTemplate { id: string; title: string; category: string }

const BRAND_ID = "brand-celsius";

export default function BirthdayPage() {
  const [templates, setTemplates] = useState<VoucherTemplate[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch(`/api/loyalty/voucher-templates?brand_id=${BRAND_ID}`, { credentials: "include" }),
          fetch(`/api/loyalty/birthday-config`, { credentials: "include" }),
        ]);
        setTemplates(await r1.json());
        const cfg = await r2.json();
        setSelected(cfg.template_id ?? "");
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/loyalty/birthday-config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: selected || null }),
      });
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Cake className="w-6 h-6" />
          Birthday Treats
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Daily cron drops the selected voucher into a customer&apos;s wallet on their birthday.
          Idempotent — one voucher per year per member. Mystery Reward reveals also boost during
          birthday month if you set that flag on a mystery pool entry.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground block mb-2 uppercase tracking-wide">
              Birthday Voucher Template
            </span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full border rounded-lg px-3 py-2.5 bg-background"
            >
              <option value="">— none (feature disabled) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.title} · {t.category}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-2">
              Members get this voucher dropped on their birthday automatically.
              Recommend a generous one (Free Drink) — high-emotion moment.
            </p>
          </label>

          <div className="flex items-center gap-3 pt-2 border-t">
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Saving…" : "Save"}
            </button>
            {savedAt && Date.now() - savedAt < 3000 && (
              <span className="text-xs text-emerald-500">Saved</span>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-card p-5">
        <h3 className="text-sm font-semibold mb-2">Cron schedule</h3>
        <p className="text-xs text-muted-foreground">
          Runs daily at 02:00 MYT via <code className="bg-muted px-1.5 rounded">/api/cron/birthday-treats</code> in the order app.
          Configure cadence in <code className="bg-muted px-1.5 rounded">vercel.json</code> or your scheduler of choice.
        </p>
      </div>
    </div>
  );
}
