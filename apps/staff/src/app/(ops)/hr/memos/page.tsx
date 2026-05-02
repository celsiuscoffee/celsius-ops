"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Award, FileText, ArrowLeft, CheckCircle2, Loader2, Megaphone, Bell } from "lucide-react";

type Memo = {
  id: string;
  issued_at: string;
  issued_by_name: string;
  type: "announcement" | "reminder" | "commendation" | "note" | "verbal_warning" | "written_warning";
  severity: "info" | "minor" | "major";
  title: string;
  body: string;
  // Per-recipient ack — sourced from hr_memo_acknowledgements join table
  // (the legacy hr_memos.acknowledged_at column is shared across recipients
  // so it could not represent multi-recipient state).
  my_acknowledged_at: string | null;
  my_acknowledgement_notes: string | null;
};

const TYPE_META = {
  announcement: { label: "Announcement", icon: Megaphone, bg: "bg-blue-50 border-blue-200", textColor: "text-blue-700" },
  reminder: { label: "Reminder", icon: Bell, bg: "bg-amber-50 border-amber-200", textColor: "text-amber-700" },
  commendation: { label: "Commendation", icon: Award, bg: "bg-green-50 border-green-200", textColor: "text-green-700" },
  note: { label: "Note", icon: FileText, bg: "bg-gray-50 border-gray-200", textColor: "text-gray-700" },
  verbal_warning: { label: "Verbal Warning", icon: AlertTriangle, bg: "bg-orange-50 border-orange-200", textColor: "text-orange-700" },
  written_warning: { label: "Written Warning", icon: AlertTriangle, bg: "bg-red-50 border-red-200", textColor: "text-red-700" },
} as const;

export default function StaffMemosPage() {
  const { data, mutate } = useFetch<{ memos: Memo[]; unacknowledgedCount: number }>("/api/hr/memos");
  const [busy, setBusy] = useState<string | null>(null);

  const memos = data?.memos || [];

  const acknowledge = async (id: string) => {
    const notes = window.prompt("Add a note (optional):") || "";
    setBusy(id);
    try {
      await fetch("/api/hr/memos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, notes }),
      });
      mutate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-4 pt-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/hr"
          aria-label="Back"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 active:scale-95 active:bg-gray-200"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Memos</h1>
      </div>

      {memos.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-gray-200 bg-gray-50 py-16">
          <FileText className="mb-2 h-10 w-10 text-gray-300" />
          <p className="font-semibold text-gray-500">No memos</p>
          <p className="text-xs text-gray-400">Manager memos will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {memos.map((m) => {
            const meta = TYPE_META[m.type];
            const Icon = meta.icon;
            return (
              <div key={m.id} className={`rounded-2xl border p-4 ${meta.bg}`}>
                <div className="mb-1 flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${meta.textColor}`} />
                  <span className={`text-xs font-semibold ${meta.textColor}`}>{meta.label}</span>
                  {m.severity === "major" && <span className="text-xs font-bold text-red-700">MAJOR</span>}
                </div>
                <p className="font-semibold">{m.title}</p>
                <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{m.body}</p>
                <p className="mt-2 text-xs text-gray-500">
                  From {m.issued_by_name} · {new Date(m.issued_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                </p>
                {m.my_acknowledged_at ? (
                  <p className="mt-2 flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="h-3 w-3" /> Acknowledged on {new Date(m.my_acknowledged_at).toLocaleDateString("en-MY")}
                  </p>
                ) : (
                  <button
                    onClick={() => acknowledge(m.id)}
                    disabled={busy === m.id}
                    className="mt-3 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {busy === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "I acknowledge this memo"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
