"use client";

import { useEffect, useMemo, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { CalendarClock, CheckCircle2, Clock, UserX, HelpCircle } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type Row = {
  user_id: string;
  name: string | null;
  nickname: string | null;
  position: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  late_minutes: number;
  open: boolean;
  status: "on_time" | "late" | "absent" | "no_roster";
};

type Resp = {
  date: string;
  outlet: { id: string; name: string };
  rows: Row[];
  summary: { rostered: number; present: number; late: number; absent: number; unrostered: number };
};

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "—";

const STATUS: Record<Row["status"], { label: string; cls: string; icon: typeof Clock }> = {
  on_time: { label: "On time", cls: "text-green-700 bg-green-50 border-green-200", icon: CheckCircle2 },
  late: { label: "Late", cls: "text-amber-700 bg-amber-50 border-amber-200", icon: Clock },
  absent: { label: "Absent", cls: "text-red-700 bg-red-50 border-red-200", icon: UserX },
  no_roster: { label: "Not rostered", cls: "text-gray-600 bg-gray-50 border-gray-200", icon: HelpCircle },
};

export default function RosterAttendancePage() {
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState("");
  const [date, setDate] = useState(mytToday);

  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");
  useEffect(() => {
    if (scheduleList?.outlets && outlets.length === 0) {
      setOutlets(scheduleList.outlets);
      if (scheduleList.outlets.length > 0 && !outletId) setOutletId(scheduleList.outlets[0].id);
    }
  }, [scheduleList, outlets.length, outletId]);

  const { data, isLoading } = useFetch<Resp>(
    outletId && date ? `/api/hr/schedules/roster-attendance?outlet_id=${outletId}&date=${date}` : null,
  );

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const s = data?.summary;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Roster Attendance"
        description="Who's rostered vs. who actually showed up — on time, late, or absent"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="rounded-lg border bg-card px-3 py-1.5 text-sm"
            >
              <option value="">Select outlet…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border bg-card px-3 py-1.5 text-sm"
            />
          </div>
        }
      />

      {/* Summary chips */}
      {s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Rostered" value={s.rostered} />
          <Stat label="Present" value={s.present} tone="green" />
          <Stat label="Late" value={s.late} tone="amber" />
          <Stat label="Absent" value={s.absent} tone="red" />
          <Stat label="Unrostered" value={s.unrostered} />
        </div>
      )}

      {!outletId ? (
        <Empty icon={CalendarClock} title="Pick an outlet" body="Select an outlet and date to see the roster vs. attendance." />
      ) : isLoading ? (
        <Empty icon={CalendarClock} title="Loading…" body="" />
      ) : rows.length === 0 ? (
        <Empty icon={CalendarClock} title="Nothing here" body="No rostered shifts or attendance for this day." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Staff</th>
                <th className="px-4 py-2.5 font-semibold">Rostered</th>
                <th className="px-4 py-2.5 font-semibold">Clock in</th>
                <th className="px-4 py-2.5 font-semibold">Clock out</th>
                <th className="px-4 py-2.5 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const st = STATUS[r.status];
                const Icon = st.icon;
                return (
                  <tr key={r.user_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.name || r.user_id.slice(0, 8) + "…"}</div>
                      {r.position && <div className="text-xs text-muted-foreground">{r.position}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {r.scheduled_start ? `${r.scheduled_start}–${r.scheduled_end ?? "?"}` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {fmtTime(r.clock_in)}
                      {r.open && r.clock_in && <span className="ml-1 text-xs text-blue-600">· in</span>}
                    </td>
                    <td className="px-4 py-2.5">{fmtTime(r.clock_out)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        {r.status === "late" && r.late_minutes > 0 && (
                          <span className="text-xs text-amber-700">{r.late_minutes} min</span>
                        )}
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                          <Icon className="h-3 w-3" />
                          {st.label}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" }) {
  const toneCls =
    tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ icon: Icon, title, body }: { icon: typeof CalendarClock; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
      <Icon className="mb-3 h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}
