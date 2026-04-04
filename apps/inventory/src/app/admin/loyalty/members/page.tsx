"use client";

import { UserCheck } from "lucide-react";

export default function MembersPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-terracotta/10 p-2">
          <UserCheck className="h-5 w-5 text-terracotta" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Members</h2>
          <p className="text-sm text-gray-500">View and manage loyalty program members</p>
        </div>
      </div>
      <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-terracotta/10 px-3 py-1">
        <span className="text-sm font-semibold text-terracotta">16,803 members</span>
      </div>
      <div className="mt-8 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 py-16">
        <UserCheck className="h-10 w-10 text-gray-300" />
        <p className="mt-3 text-sm font-medium text-gray-400">Coming soon</p>
        <p className="mt-1 text-xs text-gray-300">This module will be connected to the loyalty database</p>
      </div>
    </div>
  );
}
