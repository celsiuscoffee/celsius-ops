"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, BellRing, Check, Clock, Plus, X, FileText, Send } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Reminder = {
  id: string;
  title: string;
  notes: string | null;
  createdByName: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  status: string;
  snoozedUntil: string | null;
  overdue: boolean;
  notified: boolean;
};
type Assignee = { id: string; name: string; role: string };
type Memo = { id: string; title: string; body: string; severity: string; issuedAt: string; recipients: string[] };
type Payload = { reminders: Reminder[]; assignees: Assignee[]; memos: Memo[] };

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RemindersPanel({ onChange }: { onChange: () => void }) {
  const { data, isLoading, mutate } = useFetch<Payload>("/api/ops/workspace/reminders");
  const reminders = data?.reminders ?? [];
  const assignees = data?.assignees ?? [];
  const memos = data?.memos ?? [];

  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    await mutate();
    onChange();
  };

  const create = async () => {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      await fetch("/api/ops/workspace/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          dueAt: due ? new Date(due).toISOString() : null,
          assigneeUserId: assignee || null,
        }),
      });
      setTitle("");
      setDue("");
      setAssignee("");
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, action: "done" | "snooze" | "cancel", snoozedUntil?: string) => {
    setBusy(id);
    try {
      await fetch(`/api/ops/workspace/reminders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, snoozedUntil: snoozedUntil ?? null }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const snoozeOneDay = (id: string) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    act(id, "snooze", d.toISOString());
  };

  return (
    <Card className="h-[calc(100vh-15rem)] overflow-y-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <BellRing className="h-4 w-4 text-terracotta" />
        <span className="text-sm font-medium">Reminders</span>
      </div>

      {/* New reminder */}
      <div className="mb-4 rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
            placeholder="New reminder — e.g. 'Chase Samudra invoice #1042'"
            className="flex-1"
            disabled={saving}
          />
          <input
            type="datetime-local"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            disabled={saving}
          />
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
            disabled={saving}
          >
            <option value="">Unassigned (me)</option>
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <Button
            onClick={create}
            disabled={saving || !title.trim()}
            className="gap-1 bg-terracotta hover:bg-terracotta-dark"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-6 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {reminders.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No open reminders. Add one above.
            </div>
          ) : (
            <ul className="space-y-2">
              {reminders.map((r) => {
                const snoozed = r.status === "SNOOZED";
                return (
                  <li
                    key={r.id}
                    className={
                      "rounded-lg border p-3 " +
                      (r.overdue ? "border-red-200 bg-red-50/40" : snoozed ? "bg-muted/30" : "bg-card")
                    }
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{r.title}</div>
                        {r.notes && <div className="mt-0.5 text-xs text-muted-foreground">{r.notes}</div>}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {r.dueAt && (
                            <span className={"flex items-center gap-1 " + (r.overdue ? "text-red-600" : "")}>
                              <Clock className="h-3 w-3" /> {fmtTime(r.dueAt)}
                            </span>
                          )}
                          {r.overdue && <Badge className="bg-red-600 text-[10px] text-white">Overdue</Badge>}
                          {snoozed && (
                            <Badge variant="secondary" className="text-[10px]">
                              Snoozed → {fmtTime(r.snoozedUntil)}
                            </Badge>
                          )}
                          {r.assigneeName && <span>→ {r.assigneeName}</span>}
                          {r.assigneeName && r.notified && (
                            <span className="flex items-center gap-0.5 text-green-700" title="Pinged on WhatsApp">
                              <Send className="h-3 w-3" /> WhatsApp&apos;d
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === r.id}
                          onClick={() => snoozeOneDay(r.id)}
                          className="h-7 gap-1 px-2 text-xs"
                          title="Snooze 1 day"
                        >
                          <Clock className="h-3.5 w-3.5" /> 1d
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy === r.id}
                          onClick={() => act(r.id, "done")}
                          className="h-7 gap-1 bg-terracotta px-2 text-xs hover:bg-terracotta-dark"
                        >
                          {busy === r.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Done
                        </Button>
                        <button
                          onClick={() => act(r.id, "cancel")}
                          disabled={busy === r.id}
                          title="Cancel"
                          className="text-muted-foreground hover:text-red-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* HR reminder memos — read-only mirror */}
          {memos.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileText className="h-3.5 w-3.5" /> HR reminder memos
              </div>
              <ul className="space-y-2">
                {memos.map((m) => (
                  <li key={m.id} className="rounded-lg border border-dashed p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{m.title}</span>
                      {m.severity && m.severity !== "info" && (
                        <Badge className="bg-amber-100 text-[10px] text-amber-700">{m.severity}</Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground">{fmtTime(m.issuedAt)}</span>
                    </div>
                    {m.body && <div className="mt-0.5 text-xs text-muted-foreground">{m.body}</div>}
                    {m.recipients.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">→ {m.recipients.join(", ")}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
