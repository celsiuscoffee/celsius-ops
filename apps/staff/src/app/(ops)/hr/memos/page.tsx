"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { HRPageHeader } from "@/components/hr-page-header";
import { AlertTriangle, Award, FileText, CheckCircle2, Loader2, Megaphone, Bell } from "lucide-react";
import { usePrompt } from "@celsius/ui";
import { FetchError } from "@/components/fetch-error";

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
  announcement: { label: "Announcement", icon: Megaphone, bg: "bg-info-soft border-info/30", textColor: "text-info-text" },
  reminder: { label: "Reminder", icon: Bell, bg: "bg-warn-soft border-warn/30", textColor: "text-warn-text" },
  commendation: { label: "Commendation", icon: Award, bg: "bg-ok-soft border-ok/30", textColor: "text-ok-text" },
  note: { label: "Note", icon: FileText, bg: "bg-sunken/60 border-line", textColor: "text-text-2" },
  verbal_warning: { label: "Verbal warning", icon: AlertTriangle, bg: "bg-warn-soft border-warn/30", textColor: "text-warn-text" },
  written_warning: { label: "Written warning", icon: AlertTriangle, bg: "bg-danger-soft border-danger/30", textColor: "text-danger-text" },
} as const;

export default function StaffMemosPage() {
  const { data, error, mutate } = useFetch<{ memos: Memo[]; unacknowledgedCount: number }>("/api/hr/memos");
  const [busy, setBusy] = useState<string | null>(null);
  const { prompt, PromptDialog } = usePrompt();

  const memos = data?.memos || [];

  const acknowledge = async (id: string) => {
    const notes = await prompt({
      title: "Acknowledge this memo",
      description: "Add a note if you want — optional.",
      placeholder: "Optional note…",
      multiline: true,
      confirmLabel: "Acknowledge",
    });
    if (notes === null) return; // cancelled
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
    <div className="px-4 pb-6">
      <PromptDialog />
      <HRPageHeader title="Memos" subtitle="Notes, warnings and thanks from your managers." />

      {!data && error ? (
        <FetchError error={error} onRetry={() => mutate()} what="your memos" />
      ) : memos.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-line bg-sunken/60 py-16">
          <FileText className="mb-2 h-10 w-10 text-line-ctl" />
          <p className="font-semibold text-text-3">No memos</p>
          <p className="text-xs text-text-3">Manager memos will appear here</p>
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
                  {m.severity === "major" && <span className="text-xs font-bold text-danger-text">Major</span>}
                </div>
                <p className="font-semibold">{m.title}</p>
                <p className="mt-1 text-sm text-text-2 whitespace-pre-wrap">{m.body}</p>
                <p className="mt-2 text-xs text-text-3">
                  From {m.issued_by_name} · {new Date(m.issued_at).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}
                </p>
                {m.my_acknowledged_at ? (
                  <p className="mt-2 flex items-center gap-1 text-xs text-ok-text">
                    <CheckCircle2 className="h-3 w-3" /> Acknowledged on {new Date(m.my_acknowledged_at).toLocaleDateString("en-MY")}
                  </p>
                ) : (
                  <button
                    onClick={() => acknowledge(m.id)}
                    disabled={busy === m.id}
                    className="mt-3 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-on-ink disabled:opacity-50"
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
