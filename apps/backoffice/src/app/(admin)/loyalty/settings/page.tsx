"use client";

import { useEffect, useState } from "react";
import { Coins, Save, Loader2 } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { toast } from "@celsius/ui";

/**
 * Loyalty Settings — programme-wide config that isn't a specific reward.
 * Today: the base earn rate (points per RM), relocated here from the org-wide
 * System Settings page. Stored in app_settings.points_per_rm.
 */
type PointsPerRm = { rate: number };
const SETTINGS_API = "/api/settings";

export default function LoyaltySettingsPage() {
  const [pts, setPts] = useState<PointsPerRm>({ rate: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await adminFetch(`${SETTINGS_API}?key=points_per_rm`).then((res) =>
          res.json().catch(() => null),
        );
        if (r && typeof r.rate === "number") setPts(r);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const res = await adminFetch(SETTINGS_API, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "points_per_rm", value: pts }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Earn rate saved");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 sm:p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Loyalty Settings</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Programme-wide loyalty config — applies to every outlet + channel.
        </p>
      </div>

      <div className="max-w-xl rounded-xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
            <Coins className="h-4.5 w-4.5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Loyalty: points per RM</h3>
            <p className="mt-0.5 text-xs text-gray-500">Base earn rate; e.g. 1 = 1 pt/RM, 2 = double points.</p>
          </div>
        </div>
        {loading ? (
          <div className="flex h-10 items-center text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            <label className="mt-3 flex items-center gap-3">
              <span className="block text-[11px] font-medium text-gray-600">Rate</span>
              <input
                type="number"
                step="0.5"
                min={0}
                value={pts.rate}
                onChange={(e) => setPts({ rate: Number(e.target.value) })}
                className="w-32 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-terracotta px-4 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
