"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Loader2, Trash2, Calendar, User, Clock, CalendarDays } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";

type Sop = { id: string; title: string; category: { name: string } };
type Outlet = { id: string; code: string; name: string };
type Staff = { id: string; name: string; role: string; outlet: { name: string } | null };

type Schedule = {
  id: string;
  shift: "OPENING" | "MIDDAY" | "CLOSING";
  recurrence: "SHIFT" | "SPECIFIC_TIMES" | "HOURLY";
  times: string[];
  dueMinutes: number;
  daysOfWeek: number[];
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  sop: { id: string; title: string; category: { name: string } };
  outlet: { id: string; code: string; name: string };
  assignedTo: { id: string; name: string; role: string };
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHIFT_LABELS: Record<string, string> = { OPENING: "Opening", MIDDAY: "Midday", CLOSING: "Closing" };
const SHIFT_COLORS: Record<string, string> = {
  OPENING: "bg-amber-100 text-amber-700",
  MIDDAY: "bg-blue-100 text-blue-700",
  CLOSING: "bg-purple-100 text-purple-700",
};
const RECURRENCE_LABELS: Record<string, string> = {
  SHIFT: "Once per shift",
  SPECIFIC_TIMES: "At specific times",
  HOURLY: "Every hour",
};

export default function SchedulesPage() {
  const { data: schedules, isLoading, mutate } = useFetch<Schedule[]>("/api/ops/schedules");
  const { data: sops } = useFetch<Sop[]>("/api/ops/sops?status=PUBLISHED");
  const { data: outlets } = useFetch<Outlet[]>("/api/ops/outlets");
  const { data: staff } = useFetch<Staff[]>("/api/ops/staff");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [sopId, setSopId] = useState("");
  const [outletId, setOutletId] = useState("");
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [shift, setShift] = useState("OPENING");
  const [recurrence, setRecurrence] = useState<"SHIFT" | "SPECIFIC_TIMES" | "HOURLY">("SHIFT");
  const [times, setTimes] = useState<string[]>([]);
  const [newTime, setNewTime] = useState("08:00");
  const [dueMinutes, setDueMinutes] = useState(0);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const openCreate = () => {
    setSopId(""); setOutletId(""); setSelectedStaff(new Set());
    setShift("OPENING"); setRecurrence("SHIFT");
    setTimes([]); setNewTime("08:00"); setDueMinutes(0);
    setDaysOfWeek([1, 2, 3, 4, 5, 6, 7]);
    setError(""); setDialogOpen(true);
  };

  const addTime = () => {
    if (newTime && !times.includes(newTime)) {
      setTimes([...times, newTime].sort());
    }
  };
  const removeTime = (t: string) => setTimes(times.filter((x) => x !== t));

  const toggleStaff = (id: string) => {
    setSelectedStaff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  const handleSave = async () => {
    if (!sopId || !outletId || selectedStaff.size === 0) { setError("Select SOP, outlet, and at least one staff member"); return; }
    if (daysOfWeek.length === 0) { setError("Select at least one day"); return; }
    setSaving(true);
    setError("");

    try {
      const staffIds = Array.from(selectedStaff);
      let created = 0;
      let skipped = 0;

      for (const staffId of staffIds) {
        const res = await fetch("/api/ops/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sopId, outletId, assignedToId: staffId, shift, recurrence, times: recurrence === "SPECIFIC_TIMES" ? times : [], dueMinutes, daysOfWeek }),
        });
        if (res.ok) created++;
        else {
          const data = await res.json();
          if (res.status === 409) skipped++;
          else { setError(data.error || "Failed to create"); return; }
        }
      }

      if (skipped > 0 && created === 0) {
        setError(`All ${skipped} schedule(s) already exist`);
        return;
      }
      setDialogOpen(false);
      mutate();
    } catch {
      setError("Connection error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this schedule?")) return;
    await fetch(`/api/ops/schedules/${id}`, { method: "DELETE" });
    mutate();
  };

  const toggleActive = async (schedule: Schedule) => {
    await fetch(`/api/ops/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !schedule.isActive }),
    });
    mutate();
  };

  // Filter staff by selected outlet
  const filteredStaff = staff?.filter((s) => {
    if (!outletId) return true;
    return s.outlet?.name || true; // show all for now, can filter by outletId later
  });

  return (
    <div className="p-3 sm:p-6 lg:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Schedules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign SOPs to staff with recurring schedules
          </p>
        </div>
        <Button onClick={openCreate} className="bg-terracotta hover:bg-terracotta-dark">
          <Plus className="mr-2 h-4 w-4" />New Schedule
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !schedules || schedules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12">
            <Calendar className="h-10 w-10 text-muted-foreground/40" />
            <p className="mt-3 text-sm text-muted-foreground">No schedules yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Create a schedule to auto-generate daily checklists for staff
            </p>
            <Button onClick={openCreate} variant="outline" className="mt-4">
              <Plus className="mr-2 h-4 w-4" />Create first schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id} className={!s.isActive ? "opacity-50" : ""}>
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-medium text-foreground">{s.sop.title}</h3>
                      <Badge variant="secondary" className="text-[10px]">{s.sop.category.name}</Badge>
                      <Badge className={`text-[10px] ${SHIFT_COLORS[s.shift]}`}>
                        {SHIFT_LABELS[s.shift]}
                      </Badge>
                      {s.recurrence !== "SHIFT" && (
                        <Badge variant="outline" className="text-[10px]">
                          {RECURRENCE_LABELS[s.recurrence]}
                        </Badge>
                      )}
                      {!s.isActive && <Badge variant="outline" className="text-[10px]">Paused</Badge>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />{s.assignedTo.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />{s.outlet.name}
                      </span>
                      {s.times.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />{s.times.join(", ")}
                        </span>
                      )}
                      {s.dueMinutes > 0 && (
                        <span className="text-amber-600">Due within {s.dueMinutes}min</span>
                      )}
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {s.daysOfWeek.map((d) => DAY_LABELS[d - 1]).join(", ")}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => toggleActive(s)}
                      className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                        s.isActive
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      {s.isActive ? "Active" : "Paused"}
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">SOP *</label>
              <select
                value={sopId}
                onChange={(e) => setSopId(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select a published SOP</option>
                {sops?.map((s) => (
                  <option key={s.id} value={s.id}>{s.title} ({s.category.name})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Outlet *</label>
                <select
                  value={outletId}
                  onChange={(e) => setOutletId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select outlet</option>
                  {outlets?.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Shift *</label>
                <select
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="OPENING">Opening</option>
                  <option value="MIDDAY">Midday</option>
                  <option value="CLOSING">Closing</option>
                </select>
              </div>
            </div>

            {/* Recurrence */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Frequency</label>
              <div className="flex gap-1.5">
                {(["SHIFT", "SPECIFIC_TIMES", "HOURLY"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => { setRecurrence(r); if (r === "SHIFT") setTimes([]); }}
                    className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                      recurrence === r ? "bg-terracotta text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {RECURRENCE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>

            {/* Times — for SPECIFIC_TIMES */}
            {recurrence === "SPECIFIC_TIMES" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Times *</label>
                <div className="flex gap-2 mb-2">
                  <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
                  <Button type="button" variant="outline" size="sm" onClick={addTime}>Add</Button>
                </div>
                {times.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {times.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1 rounded-full bg-terracotta/10 px-2.5 py-1 text-xs text-terracotta">
                        {t}
                        <button onClick={() => removeTime(t)} className="hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                )}
                {times.length === 0 && <p className="text-xs text-muted-foreground">Add at least one time</p>}
              </div>
            )}

            {/* Due within */}
            {recurrence !== "SHIFT" && (
              <div>
                <label className="mb-1.5 block text-sm font-medium">Due within (minutes)</label>
                <div className="flex gap-1.5">
                  {[0, 15, 30, 60].map((m) => (
                    <button key={m} type="button" onClick={() => setDueMinutes(m)}
                      className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                        dueMinutes === m ? "bg-terracotta text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {m === 0 ? "No limit" : `${m} min`}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Assign to Staff * <span className="text-xs text-muted-foreground font-normal">({selectedStaff.size} selected)</span>
              </label>
              <div className="max-h-72 overflow-y-auto rounded-md border border-input p-2 space-y-0.5">
                {filteredStaff?.map((s) => {
                  const isSelected = selectedStaff.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStaff(s.id)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                        isSelected ? "bg-terracotta/10 text-foreground" : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        isSelected ? "bg-terracotta border-terracotta text-white" : "border-input"
                      }`}>
                        {isSelected && <span className="text-[10px]">✓</span>}
                      </div>
                      <span className={isSelected ? "font-medium" : ""}>{s.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {s.role}{s.outlet ? ` · ${s.outlet.name}` : ""}
                      </span>
                    </button>
                  );
                })}
                {(!filteredStaff || filteredStaff.length === 0) && (
                  <p className="py-3 text-center text-xs text-muted-foreground">No staff found</p>
                )}
              </div>
              {filteredStaff && filteredStaff.length > 0 && (
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStaff(new Set(filteredStaff.map((s) => s.id)))}
                    className="text-[10px] text-terracotta hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStaff(new Set())}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Days *</label>
              <div className="flex gap-1.5">
                {DAY_LABELS.map((label, i) => {
                  const day = i + 1;
                  const selected = daysOfWeek.includes(day);
                  return (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      className={`flex-1 rounded-md py-2 text-xs font-medium transition-colors ${
                        selected
                          ? "bg-terracotta text-white"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
