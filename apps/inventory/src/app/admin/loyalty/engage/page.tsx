"use client";

import { MessageSquare } from "lucide-react";

export default function EngagePage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-terracotta/10 p-2">
          <MessageSquare className="h-5 w-5 text-terracotta" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Engage</h2>
          <p className="text-sm text-gray-500">Send SMS blasts and push notifications to members</p>
        </div>
      </div>
      <div className="mt-8 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16">
        <MessageSquare className="h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-400">Coming soon</p>
        <p className="mt-1 text-xs text-gray-300">This module will be connected to the loyalty database</p>
      </div>
    </div>
  );
}
