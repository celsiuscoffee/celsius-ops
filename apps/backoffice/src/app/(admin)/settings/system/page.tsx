"use client";

import { Hash } from "lucide-react";

export default function SystemSettingsPage() {
  return (
    <div className="p-3 sm:p-6">
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
              <p className="text-xs text-gray-500">PIN length for staff login at inventory &amp; rewards portals</p>
            </div>
          </div>

          <div className="flex-1 rounded-xl border-2 border-terracotta bg-terracotta/5 p-4 text-center max-w-xs">
            <div className="flex items-center justify-center gap-1.5 mb-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-3 w-3 rounded-full bg-terracotta" />
              ))}
            </div>
            <p className="text-sm font-semibold text-terracotta-dark">6-digit PIN</p>
            <p className="mt-0.5 text-[10px] text-gray-400">Secure</p>
          </div>

          <p className="mt-3 text-[10px] text-gray-400">
            All staff PINs are standardized to 6 digits for security.
          </p>
        </div>
      </div>
    </div>
  );
}
