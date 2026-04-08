"use client";

import { useState, useEffect } from "react";
import { Loader2, Check, Hash } from "lucide-react";

type SystemSettings = {
  pinLength: number;
};

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState<SystemSettings>({ pinLength: 4 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/system")
      .then((r) => r.json())
      .then((data) => {
        setSettings({ pinLength: data.pinLength || 4 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const updatePinLength = async (len: number) => {
    setSettings({ ...settings, pinLength: len });
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/system", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinLength: len }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // revert
      setSettings((prev) => ({ ...prev }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">System Settings</h2>
        <p className="mt-0.5 text-sm text-gray-500">Global settings that apply across all apps</p>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* PIN Length */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
              <Hash className="h-4.5 w-4.5 text-violet-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Staff PIN Length</h3>
              <p className="text-xs text-gray-500">Set PIN length for staff login at inventory &amp; loyalty portals</p>
            </div>
            {saving && <Loader2 className="ml-auto h-4 w-4 animate-spin text-gray-400" />}
            {saved && (
              <span className="ml-auto flex items-center gap-1 text-xs text-green-600">
                <Check className="h-3.5 w-3.5" />Saved
              </span>
            )}
          </div>

          <div className="flex gap-3">
            {[4, 6].map((len) => (
              <button
                key={len}
                onClick={() => updatePinLength(len)}
                className={`flex-1 rounded-xl border-2 p-4 text-center transition-all ${
                  settings.pinLength === len
                    ? "border-terracotta bg-terracotta/5"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-center gap-1.5 mb-2">
                  {Array.from({ length: len }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-3 w-3 rounded-full ${
                        settings.pinLength === len ? "bg-terracotta" : "bg-gray-300"
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-sm font-semibold ${settings.pinLength === len ? "text-terracotta-dark" : "text-gray-600"}`}>
                  {len}-digit PIN
                </p>
                <p className="mt-0.5 text-[10px] text-gray-400">
                  {len === 4 ? "Faster entry, simpler" : "More secure"}
                </p>
              </button>
            ))}
          </div>

          <p className="mt-3 text-[10px] text-gray-400">
            Changing PIN length affects all new PINs. Existing PINs of the other length will still work until reset.
          </p>
        </div>
      </div>
    </div>
  );
}
