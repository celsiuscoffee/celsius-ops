"use client";

import { useEffect, useState } from "react";
import { Layers, Pencil, X, Loader2, Save } from "lucide-react";
import { toast } from "@celsius/ui";
import { cn } from "@/lib/utils";

interface RewardKind {
  id: string;
  label: string;
  description: string | null;
  category: string | null;
  sort_order: number;
  is_active: boolean;
  color: string | null;
  illustration_url: string | null;
  updated_at: string;
}

export default function RewardKindsPage() {
  const [kinds, setKinds] = useState<RewardKind[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<RewardKind | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/loyalty/reward-kinds", { credentials: "include" });
      const data = await res.json();
      setKinds(Array.isArray(data) ? data : []);
    } catch {
      setKinds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Layers className="w-6 h-6" />
          Outcome Types
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          The five fundamental reward shapes the engagement engine understands. Mystery Pool,
          Challenges, Birthday Treats, and Admin Claimables all pull their "what kind of reward is
          this?" dropdowns from this list. Set a colour + illustration here to override the default
          card theme on the native rewards screen.
          <br />
          <span className="text-xs text-muted-foreground/80">
            <strong>id</strong> values are referenced by the discount + reveal engines and aren't editable here.
            Labels, descriptions, sort order, visuals, and active flag are safe to change without a deploy.
            Adding a brand-new behaviour (e.g. "Time Travel Token") still needs a code change.
          </span>
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : kinds.length === 0 ? (
        <div className="text-sm text-muted-foreground">No reward kinds configured.</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Label</th>
                <th className="px-4 py-3 text-left font-medium">id (code-bound)</th>
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-left font-medium">Visual</th>
                <th className="px-4 py-3 text-left font-medium">Order</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Edit</th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((k) => (
                <tr key={k.id} className={cn("border-t", !k.is_active && "opacity-50")}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{k.label}</div>
                    {k.description && (
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{k.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded">{k.id}</code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{k.category ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {k.color ? (
                        <span
                          className="inline-block w-5 h-5 rounded border"
                          style={{ backgroundColor: k.color }}
                          title={k.color}
                        />
                      ) : (
                        <span className="inline-block w-5 h-5 rounded border bg-muted" title="No colour set" />
                      )}
                      {k.illustration_url ? (
                        <img
                          src={k.illustration_url}
                          alt=""
                          className="w-5 h-5 rounded object-cover border"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">no art</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{k.sort_order}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded",
                        k.is_active ? "bg-emerald-100 text-emerald-900" : "bg-gray-100 text-gray-600",
                      )}
                    >
                      {k.is_active ? "Active" : "Hidden"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(k)}
                      className="p-1.5 rounded-md hover:bg-muted inline-flex items-center"
                      aria-label="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal
          kind={editing}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function EditModal({
  kind,
  onCancel,
  onSaved,
}: {
  kind: RewardKind;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<RewardKind>(kind);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/loyalty/reward-kinds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          id: draft.id,
          label: draft.label.trim(),
          description: draft.description?.trim() ?? null,
          category: draft.category?.trim() ?? null,
          sort_order: draft.sort_order,
          is_active: draft.is_active,
          color: draft.color?.trim() ? draft.color.trim() : null,
          illustration_url: draft.illustration_url?.trim() ? draft.illustration_url.trim() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to save");
        return;
      }
      toast.success(`Updated "${draft.label}"`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-md md:max-w-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Edit reward kind
          </h2>
          <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              id (code-bound, not editable)
            </label>
            <code className="block text-sm bg-muted px-3 py-2 rounded-md">{draft.id}</code>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Label</label>
            <input
              className="w-full px-3 py-2 rounded-md border bg-background"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Description (shown as helper text in admin dropdowns)
            </label>
            <textarea
              rows={3}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={draft.description ?? ""}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Category</label>
              <input
                className="w-full px-3 py-2 rounded-md border bg-background"
                placeholder="Voucher / Beans / In-store"
                value={draft.category ?? ""}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Sort order</label>
              <input
                type="number"
                min={0}
                className="w-full px-3 py-2 rounded-md border bg-background"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="border-t pt-4 -mx-5 px-5 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Card visuals (native rewards screen)
            </div>
            <div className="text-xs text-muted-foreground -mt-2">
              Overrides the default source-bucket theme (challenge / mystery / gift / bean) when a voucher,
              mission outcome, or mystery outcome is bound to this kind. Leave blank to fall back.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Card colour (hex)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="h-9 w-12 rounded-md border bg-background cursor-pointer"
                    value={draft.color ?? "#1A0200"}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  />
                  <input
                    className="flex-1 px-3 py-2 rounded-md border bg-background font-mono text-sm"
                    placeholder="#FBBF24"
                    value={draft.color ?? ""}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Illustration URL
                </label>
                <input
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  placeholder="https://res.cloudinary.com/..."
                  value={draft.illustration_url ?? ""}
                  onChange={(e) => setDraft({ ...draft, illustration_url: e.target.value })}
                />
              </div>
            </div>
            {draft.illustration_url ? (
              <div className="flex items-center gap-3 p-2 rounded-md bg-muted/40">
                <img
                  src={draft.illustration_url}
                  alt="Preview"
                  className="w-16 h-16 rounded-lg object-cover border"
                />
                <div className="text-xs text-muted-foreground">
                  Preview · shown on the native reward card. Square 1:1 PNG with transparent background works best.
                </div>
              </div>
            ) : null}
          </div>

          <label className="flex items-start gap-2 text-sm border rounded-md p-3">
            <input
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium block">Show in admin dropdowns</span>
              <span className="text-xs text-muted-foreground">
                Inactive kinds are hidden from the Mystery Pool / Mission / Birthday outcome pickers, but
                existing rows that already reference them keep working.
              </span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-md border hover:bg-muted text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !draft.label.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
