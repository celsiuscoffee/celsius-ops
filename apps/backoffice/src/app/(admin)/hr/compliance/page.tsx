"use client";

import { useState } from "react";
import { HrPageHeader } from "@/components/hr/page-header";
import { useFetch } from "@/lib/use-fetch";
import { Loader2, Plus, Save, Trash2, AlertTriangle, CheckCircle2, ShieldAlert, Calendar } from "lucide-react";
import { useConfirm, toast } from "@celsius/ui";

type Event = {
  id: string;
  category: string;
  title: string;
  due_date: string;
  recurrence: string;
  related_user_id: string | null;
  status: string;
  reminder_days: number;
  notes: string | null;
  is_overdue?: boolean;
};

const CATEGORIES = [
  { v: "lhdn_form_e", l: "LHDN Form E (annual)" },
  { v: "lhdn_cp8d", l: "LHDN CP8D (annual)" },
  { v: "lhdn_cp39_pcb", l: "LHDN CP39 / PCB (monthly)" },
  { v: "kwsp_form_a", l: "KWSP Form A (monthly)" },
  { v: "perkeso_form", l: "PERKESO submission (monthly)" },
  { v: "hrdf", l: "HRDF (monthly)" },
  { v: "work_permit", l: "Work permit / EP renewal" },
  { v: "license_renewal", l: "License renewal" },
  { v: "audit", l: "Audit / inspection" },
  { v: "other", l: "Other" },
];

export default function CompliancePage() {
  const { data, mutate } = useFetch<{ events: Event[] }>(`/api/hr/compliance-events`);
  const events = data?.events || [];
  const { confirm, ConfirmDialog } = useConfirm();

  const today = new Date().toISOString().slice(0, 10);
  const overdue = events.filter((e) => e.status !== "done" && e.due_date < today);
  const upcoming = events.filter((e) => e.status !== "done" && e.due_date >= today);
  const recentlyDone = events.filter((e) => e.status === "done").slice(-5).reverse();

  const [showAdd, setShowAdd] = useState(false);
  const [category, setCategory] = useState("kwsp_form_a");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [recurrence, setRecurrence] = useState("one_off");
  const [reminderDays, setReminderDays] = useState(14);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => { setShowAdd(false); setTitle(""); setNotes(""); setErr(null); };

  const submit = async () => {
    if (!category || !title || !dueDate) { setErr("Required fields missing"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/compliance-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, title, due_date: dueDate, recurrence, reminder_days: reminderDays, notes: notes || null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed");
      toast.success("Event scheduled");
      mutate();
      reset();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const [bootstrapping, setBootstrapping] = useState(false);
  const bootstrap = async () => {
    setBootstrapping(true);
    try {
      const res = await fetch("/api/hr/compliance-events/bootstrap", { method: "POST" });
      const body = await res.json();
      if (!res.ok) toast.error(body.error || "Failed");
      else {
        toast.success(body.message || "Seeded");
        mutate();
      }
    } finally {
      setBootstrapping(false);
    }
  };

  const markDone = async (id: string) => {
    const res = await fetch("/api/hr/compliance-events", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: id, status: "done" }),
    });
    if (res.ok) {
      toast.success("Marked done");
      mutate();
    }
  };
  const handleDelete = async (id: string) => {
    if (!(await confirm({ title: "Delete this event?", confirmLabel: "Delete", destructive: true }))) return;
    const res = await fetch(`/api/hr/compliance-events?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      mutate();
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <ConfirmDialog />
      <HrPageHeader
        title="Compliance Calendar"
        icon={<ShieldAlert className="h-6 w-6 text-terracotta" />}
        description="LHDN, KWSP, PERKESO, HRDF deadlines. Work-permit and license renewals. Recurring events auto-schedule the next occurrence on completion."
        action={
          <>
            <button
              onClick={bootstrap}
              disabled={bootstrapping}
              className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
              title="Seed standard MY statutory events (KWSP, PERKESO, CP39, HRDF, Form E, CP8D)"
            >
              {bootstrapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
              Seed standard MY events
            </button>
            {!showAdd && (
              <button onClick={() => setShowAdd(true)} className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark">
                <Plus className="h-4 w-4" /> Add event
              </button>
            )}
          </>
        }
      />

      {showAdd && (
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-3 font-semibold">New Event</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded border bg-background px-3 py-2 text-sm">
                {CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Title</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. KWSP Form A — Apr 2026" className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Due Date</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Recurrence</span>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="w-full rounded border bg-background px-3 py-2 text-sm">
                <option value="one_off">One off</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Reminder days before</span>
              <input type="number" min={0} value={reminderDays} onChange={(e) => setReminderDays(Number(e.target.value))} className="w-full rounded border px-3 py-2 text-sm" />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">Notes</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded border px-3 py-2 text-sm" />
            </label>
          </div>
          {err && <p className="mt-3 text-xs text-red-600">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="flex items-center gap-2 rounded-lg bg-terracotta px-3 py-1.5 text-sm font-medium text-white hover:bg-terracotta-dark disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      )}

      {/* Overdue */}
      {overdue.length > 0 && (
        <Section title="Overdue" icon={<AlertTriangle className="h-5 w-5 text-red-600" />} color="red">
          {overdue.map((e) => <EventRow key={e.id} event={e} onDone={markDone} onDelete={handleDelete} />)}
        </Section>
      )}

      <Section title={`Upcoming (${upcoming.length})`} icon={<Calendar className="h-5 w-5 text-blue-600" />} color="blue">
        {upcoming.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing scheduled.</p>
        ) : upcoming.map((e) => <EventRow key={e.id} event={e} onDone={markDone} onDelete={handleDelete} />)}
      </Section>

      {recentlyDone.length > 0 && (
        <Section title="Recently completed" icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} color="emerald">
          {recentlyDone.map((e) => <EventRow key={e.id} event={e} onDone={markDone} onDelete={handleDelete} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, icon, children, color }: {
  title: string; icon: React.ReactNode; children: React.ReactNode;
  color: "red" | "blue" | "emerald";
}) {
  const headerCls = color === "red" ? "bg-red-50 text-red-900" : color === "blue" ? "bg-blue-50 text-blue-900" : "bg-emerald-50 text-emerald-900";
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className={`flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold ${headerCls}`}>
        {icon} {title}
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function EventRow({ event, onDone, onDelete }: { event: Event; onDone: (id: string) => void; onDelete: (id: string) => void }) {
  const cat = CATEGORIES.find((c) => c.v === event.category)?.l || event.category;
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <span className="font-mono text-xs text-gray-500 w-24">{event.due_date}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{event.title}</div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">{cat} · {event.recurrence}</div>
      </div>
      {event.status !== "done" && (
        <button onClick={() => onDone(event.id)} className="rounded border bg-white px-2 py-1 text-[10px] hover:bg-emerald-50">
          Mark done
        </button>
      )}
      <button onClick={() => onDelete(event.id)} className="rounded border border-red-200 bg-red-50 p-1 text-red-600 hover:bg-red-100">
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}
