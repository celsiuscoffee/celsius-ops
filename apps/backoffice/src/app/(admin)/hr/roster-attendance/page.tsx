"use client";

import { useEffect, useMemo, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { CalendarClock, CheckCircle2, Clock, UserX, HelpCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type Status = "on_time" | "late" | "absent" | "no_roster" | "off";
type Cell = {
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  total_hours: number | null;
  late_minutes: number;
  open: boolean;
  status: Status;
};
type Staff = { user_id: string; name: string | null; nickname: string | null; position: string | null };
type DayRow = Staff & Cell;
type Summary = { rostered: number; present: number; late: number; absent: number; unrostered: number };
type DayResp = { mode: "day"; date: string; outlet: { id: string; name: string }; rows: DayRow[]; summary: Summary };
type WeekResp = {
  mode: "week";
  week_start: string;
  days: string[];
  outlet: { id: string; name: string };
  staff: (Staff & { days: Record<string, Cell> })[];
  summary: Summary;
};

const DAY_MS = 24 * 3600 * 1000;
const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
function mytMonday() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const dow = now.getUTCDay(); // 0=Sun..6=Sat (already MYT-shifted)
  return new Date(now.getTime() + (dow === 0 ? -6 : 1 - dow) * DAY_MS).toISOString().slice(0, 10);
}
const shiftDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);
const fmtTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDayHead = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-MY", { weekday: "short", day: "2-digit", month: "short" });
const fmtRange = (start: string) =>
  `${new Date(start + "T00:00:00").toLocaleDateString("en-MY", { day: "2-digit", month: "short" })} – ${new Date(shiftDays(start, 6) + "T00:00:00").toLocaleDateString("en-MY", { day: "2-digit", month: "short" })}`;

const STATUS: Record<Status, { label: string; cls: string; icon: typeof Clock }> = {
  on_time: { label: "On time", cls: "text-green-700 bg-green-50 border-green-200", icon: CheckCircle2 },
  late: { label: "Late", cls: "text-amber-700 bg-amber-50 border-amber-200", icon: Clock },
  absent: { label: "Absent", cls: "text-red-700 bg-red-50 border-red-200", icon: UserX },
  no_roster: { label: "Not rostered", cls: "text-gray-600 bg-gray-50 border-gray-200", icon: HelpCircle },
  off: { label: "Off", cls: "text-gray-400 bg-transparent border-transparent", icon: HelpCircle },
};

export default function RosterAttendancePage() {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState("");
  const [date, setDate] = useState(mytToday);
  const [weekStart, setWeekStart] = useState(mytMonday);

  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");
  useEffect(() => {
    if (scheduleList?.outlets && outlets.length === 0) {
      setOutlets(scheduleList.outlets);
      if (scheduleList.outlets.length > 0 && !outletId) setOutletId(scheduleList.outlets[0].id);
    }
  }, [scheduleList, outlets.length, outletId]);

  const url = !outletId
    ? null
    : mode === "day"
      ? `/api/hr/schedules/roster-attendance?outlet_id=${outletId}&date=${date}`
      : `/api/hr/schedules/roster-attendance?outlet_id=${outletId}&week_start=${weekStart}`;
  const { data, isLoading } = useFetch<DayResp | WeekResp>(url);
  const s = data?.summary;

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Roster Attendance"
        description="Who's rostered vs. who actually showed up — on time, late, or absent"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
              {(["day", "week"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 font-medium capitalize ${mode === m ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
                >
                  {m}
                </button>
              ))}
            </div>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-lg border bg-card px-3 py-1.5 text-sm">
              <option value="">Select outlet…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            {mode === "day" ? (
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-card px-3 py-1.5 text-sm" />
            ) : (
              <div className="flex items-center gap-1 rounded-lg border bg-card px-1 py-0.5 text-sm">
                <button onClick={() => setWeekStart((w) => shiftDays(w, -7))} className="rounded p-1 hover:bg-muted" aria-label="Previous week">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[9rem] text-center text-xs font-medium">{fmtRange(weekStart)}</span>
                <button onClick={() => setWeekStart((w) => shiftDays(w, 7))} className="rounded p-1 hover:bg-muted" aria-label="Next week">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        }
      />

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
        <Empty title="Pick an outlet" body="Select an outlet to see the roster vs. attendance." />
      ) : isLoading || !data ? (
        <Empty title="Loading…" body="" />
      ) : data.mode === "day" ? (
        <DayTable rows={data.rows} />
      ) : (
        <WeekGrid data={data} />
      )}
    </div>
  );
}

function DayTable({ rows }: { rows: DayRow[] }) {
  if (rows.length === 0) return <Empty title="Nothing here" body="No rostered shifts or attendance for this day." />;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
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
                <td className="px-4 py-2.5 text-muted-foreground">{r.scheduled_start ? `${r.scheduled_start}–${r.scheduled_end ?? "?"}` : "—"}</td>
                <td className="px-4 py-2.5">
                  {fmtTime(r.clock_in)}
                  {r.open && r.clock_in && <span className="ml-1 text-xs text-blue-600">· in</span>}
                </td>
                <td className="px-4 py-2.5">{fmtTime(r.clock_out)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center justify-end gap-2">
                    {r.status === "late" && r.late_minutes > 0 && <span className="text-xs text-amber-700">{r.late_minutes} min</span>}
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
  );
}

function WeekGrid({ data }: { data: WeekResp }) {
  if (data.staff.length === 0) return <Empty title="Nothing here" body="No rostered shifts or attendance this week." />;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table className="min-w-[760px] w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <th className="sticky left-0 z-10 bg-muted/40 px-4 py-2.5 text-left font-semibold">Staff</th>
            {data.days.map((d) => (
              <th key={d} className="px-2 py-2.5 text-center font-semibold">{fmtDayHead(d)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.staff.map((row) => (
            <tr key={row.user_id} className="hover:bg-muted/20">
              <td className="sticky left-0 z-10 bg-card px-4 py-2 align-top">
                <div className="font-medium">{row.name || row.user_id.slice(0, 8) + "…"}</div>
                {row.position && <div className="text-xs text-muted-foreground">{row.position}</div>}
              </td>
              {data.days.map((d) => (
                <td key={d} className="px-1.5 py-1.5 align-top">
                  <WeekCell cell={row.days[d]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekCell({ cell }: { cell: Cell }) {
  if (!cell || cell.status === "off") return <div className="h-11" />;
  const cls =
    cell.status === "on_time"
      ? "bg-green-50 border-green-200"
      : cell.status === "late"
        ? "bg-amber-50 border-amber-200"
        : cell.status === "absent"
          ? "bg-red-50 border-red-200"
          : "bg-gray-50 border-gray-200";
  return (
    <div className={`rounded-md border px-2 py-1 ${cls}`}>
      {cell.status === "absent" ? (
        <div className="text-xs font-semibold text-red-700">Absent</div>
      ) : (
        <div className="flex items-baseline justify-between gap-1">
          <span className="text-sm font-medium tabular-nums">{fmtTime(cell.clock_in)}</span>
          {cell.status === "late" && cell.late_minutes > 0 && <span className="text-[10px] font-semibold text-amber-700">+{cell.late_minutes}m</span>}
          {cell.open && <span className="text-[10px] text-blue-600">in</span>}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        {cell.scheduled_start ? `${cell.scheduled_start}–${cell.scheduled_end ?? "?"}` : "unscheduled"}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" }) {
  const toneCls = tone === "green" ? "text-green-700" : tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-foreground";
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
      <CalendarClock className="mb-3 h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}
