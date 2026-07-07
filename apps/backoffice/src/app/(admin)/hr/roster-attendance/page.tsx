"use client";

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  UserX,
  HelpCircle,
  Moon,
  MapPin,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { HrPageHeader } from "@/components/hr/page-header";

type Status = "on_time" | "late" | "absent" | "upcoming" | "rest_day" | "no_roster" | "off";
type Cell = {
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  clock_in_method: string | null;
  clock_out_method: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_out_lat: number | null;
  clock_out_lng: number | null;
  clock_in_photo_url: string | null;
  clock_out_photo_url: string | null;
  total_hours: number | null;
  regular_hours: number | null;
  overtime_hours: number | null;
  late_minutes: number;
  open: boolean;
  status: Status;
};
type Staff = { user_id: string; name: string | null; nickname: string | null; position: string | null };
type DayRow = Staff & Cell;
type Summary = { rostered: number; present: number; late: number; absent: number; upcoming: number; unrostered: number };
type DayResp = { mode: "day"; date: string; outlet: { id: string; name: string }; rows: DayRow[]; summary: Summary };
type WeekResp = {
  mode: "week";
  week_start: string;
  days: string[];
  outlet: { id: string; name: string };
  staff: (Staff & { days: Record<string, Cell> })[];
  summary: Summary;
};
// What the detail panel needs: the cell plus who/when it belongs to.
type Selection = { name: string; position: string | null; date: string; cell: Cell };

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
const fmtLongDay = (d: string) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short", year: "numeric" });
const fmtRange = (start: string) =>
  `${new Date(start + "T00:00:00").toLocaleDateString("en-MY", { day: "2-digit", month: "short" })} – ${new Date(shiftDays(start, 6) + "T00:00:00").toLocaleDateString("en-MY", { day: "2-digit", month: "short" })}`;
const fmtMethod = (m: string | null) => (m ? m.replace(/_/g, " ") : null);
const schedText = (c: Cell) => (c.scheduled_start ? `${c.scheduled_start}–${c.scheduled_end ?? "?"}` : null);

const STATUS: Record<Status, { label: string; cls: string; dot: string; icon: typeof Clock }> = {
  on_time: { label: "On time", cls: "text-green-700 bg-green-50 border-green-200", dot: "bg-green-500", icon: CheckCircle2 },
  late: { label: "Late", cls: "text-amber-700 bg-amber-50 border-amber-200", dot: "bg-amber-500", icon: Clock },
  absent: { label: "Absent", cls: "text-red-700 bg-red-50 border-red-200", dot: "bg-red-500", icon: UserX },
  upcoming: { label: "Upcoming", cls: "text-slate-500 bg-slate-50 border-slate-200", dot: "bg-slate-300", icon: CalendarClock },
  rest_day: { label: "Off day", cls: "text-indigo-500 bg-indigo-50/60 border-indigo-100", dot: "bg-indigo-300", icon: Moon },
  no_roster: { label: "Unrostered", cls: "text-sky-700 bg-sky-50 border-sky-200", dot: "bg-sky-500", icon: HelpCircle },
  off: { label: "Off", cls: "text-gray-400 bg-transparent border-transparent", dot: "bg-transparent", icon: HelpCircle },
};

export default function RosterAttendancePage() {
  const [mode, setMode] = useState<"day" | "week">("week");
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [outletId, setOutletId] = useState("");
  const [date, setDate] = useState(mytToday);
  const [weekStart, setWeekStart] = useState(mytMonday);
  const [selected, setSelected] = useState<Selection | null>(null);

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
        description="Who's rostered vs. who actually showed up — tap any shift for the clock-in details"
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Rostered" value={s.rostered} />
          <Stat label="Present" value={s.present} tone="green" />
          <Stat label="Late" value={s.late} tone="amber" />
          <Stat label="Absent" value={s.absent} tone="red" />
          <Stat label="Upcoming" value={s.upcoming} tone="slate" />
          <Stat label="Unrostered" value={s.unrostered} tone="sky" />
        </div>
      )}

      {!outletId ? (
        <Empty title="Pick an outlet" body="Select an outlet to see the roster vs. attendance." />
      ) : isLoading || !data ? (
        <Empty title="Loading…" body="" />
      ) : data.mode === "day" ? (
        <DayTable rows={data.rows} date={data.date} onSelect={setSelected} />
      ) : (
        <WeekGrid data={data} onSelect={setSelected} />
      )}

      {selected && <DetailPanel sel={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DayTable({ rows, date, onSelect }: { rows: DayRow[]; date: string; onSelect: (s: Selection) => void }) {
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
            const clickable = r.status !== "off";
            return (
              <tr
                key={r.user_id}
                onClick={clickable ? () => onSelect({ name: r.name || r.user_id.slice(0, 8), position: r.position, date, cell: r }) : undefined}
                className={clickable ? "cursor-pointer hover:bg-muted/40" : ""}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.name || r.user_id.slice(0, 8) + "…"}</div>
                  {r.position && <div className="text-xs text-muted-foreground">{r.position}</div>}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{schedText(r) ?? (r.status === "rest_day" ? "Off day" : "—")}</td>
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

function WeekGrid({ data, onSelect }: { data: WeekResp; onSelect: (s: Selection) => void }) {
  if (data.staff.length === 0) return <Empty title="Nothing here" body="No rostered shifts or attendance this week." />;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
      <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-52" />
          {data.days.map((d) => (
            <col key={d} />
          ))}
        </colgroup>
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
              <td className="sticky left-0 z-10 bg-card px-4 py-2 align-middle">
                <div className="font-medium leading-tight">{row.name || row.user_id.slice(0, 8) + "…"}</div>
                {row.position && <div className="text-xs text-muted-foreground">{row.position}</div>}
              </td>
              {data.days.map((d) => (
                <td key={d} className="px-1.5 py-1.5 align-middle">
                  <WeekCell
                    cell={row.days[d]}
                    onClick={() => onSelect({ name: row.name || row.user_id.slice(0, 8), position: row.position, date: d, cell: row.days[d] })}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Every cell is the SAME fixed height (h-14) with a two-line layout —
// line 1 = the headline (clock-in time / status word), line 2 = the sub
// (scheduled window) — so the grid reads as an even matrix regardless of
// status. Truly-nothing days render as an empty box of the same height.
function WeekCell({ cell, onClick }: { cell: Cell; onClick: () => void }) {
  if (!cell || cell.status === "off") return <div className="h-14 rounded-lg border border-transparent" />;
  const st = STATUS[cell.status];

  let headline: React.ReactNode;
  if (cell.status === "absent") headline = <span className="text-sm font-semibold">Absent</span>;
  else if (cell.status === "upcoming") headline = <span className="text-sm font-medium">Upcoming</span>;
  else if (cell.status === "rest_day") headline = <span className="text-sm font-medium">Off day</span>;
  else
    headline = (
      <span className="flex items-baseline gap-1">
        <span className="text-sm font-semibold tabular-nums">{fmtTime(cell.clock_in)}</span>
        {cell.status === "late" && cell.late_minutes > 0 && <span className="text-[10px] font-semibold text-amber-700">+{cell.late_minutes}m</span>}
        {cell.open && <span className="text-[10px] font-medium text-blue-600">in</span>}
      </span>
    );

  const sub =
    cell.status === "no_roster" ? "unscheduled" : cell.status === "rest_day" ? "" : schedText(cell) ?? "";

  return (
    <button
      onClick={onClick}
      className={`flex h-14 w-full flex-col justify-center rounded-lg border px-2 text-left transition hover:brightness-[0.97] ${st.cls}`}
    >
      {headline}
      {sub && <span className="mt-0.5 text-[10px] leading-none text-muted-foreground">{sub}</span>}
    </button>
  );
}

function DetailPanel({ sel, onClose }: { sel: Selection; onClose: () => void }) {
  const { cell } = sel;
  const st = STATUS[cell.status];
  const Icon = st.icon;
  const mapLink = (lat: number | null, lng: number | null) =>
    lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
  const inMap = mapLink(cell.clock_in_lat, cell.clock_in_lng);
  const outMap = mapLink(cell.clock_out_lat, cell.clock_out_lng);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <div className="text-base font-semibold">{sel.name}</div>
            <div className="text-xs text-muted-foreground">
              {sel.position ? `${sel.position} · ` : ""}
              {fmtLongDay(sel.date)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${st.cls}`}>
            <Icon className="h-3.5 w-3.5" />
            {st.label}
            {cell.status === "late" && cell.late_minutes > 0 && <span>· {cell.late_minutes} min late</span>}
          </span>

          <dl className="divide-y text-sm">
            <Row label="Rostered">{schedText(cell) ?? (cell.status === "rest_day" ? "Off day" : "Not rostered")}</Row>
            {cell.status !== "upcoming" && cell.status !== "rest_day" && (
              <>
                <Row label="Clock in">
                  {cell.clock_in ? (
                    <span>
                      {fmtTime(cell.clock_in)}
                      {fmtMethod(cell.clock_in_method) && <span className="text-muted-foreground"> · {fmtMethod(cell.clock_in_method)}</span>}
                      {inMap && (
                        <a href={inMap} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline">
                          <MapPin className="h-3 w-3" /> map
                        </a>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No clock-in</span>
                  )}
                </Row>
                <Row label="Clock out">
                  {cell.clock_out ? (
                    <span>
                      {fmtTime(cell.clock_out)}
                      {fmtMethod(cell.clock_out_method) && <span className="text-muted-foreground"> · {fmtMethod(cell.clock_out_method)}</span>}
                      {outMap && (
                        <a href={outMap} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline">
                          <MapPin className="h-3 w-3" /> map
                        </a>
                      )}
                    </span>
                  ) : cell.open ? (
                    <span className="text-blue-600">Still clocked in</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
                {cell.total_hours != null && (
                  <Row label="Hours">
                    <span className="tabular-nums">{cell.total_hours.toFixed(2)}h</span>
                    {cell.overtime_hours != null && cell.overtime_hours > 0 && (
                      <span className="text-muted-foreground"> · {cell.overtime_hours.toFixed(2)}h OT</span>
                    )}
                  </Row>
                )}
              </>
            )}
          </dl>

          {(cell.clock_in_photo_url || cell.clock_out_photo_url) && (
            <div className="flex gap-3">
              {cell.clock_in_photo_url && (
                <figure className="flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cell.clock_in_photo_url} alt="Clock-in selfie" className="h-28 w-full rounded-lg border object-cover" />
                  <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">Clock in</figcaption>
                </figure>
              )}
              {cell.clock_out_photo_url && (
                <figure className="flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cell.clock_out_photo_url} alt="Clock-out selfie" className="h-28 w-full rounded-lg border object-cover" />
                  <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">Clock out</figcaption>
                </figure>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" | "red" | "slate" | "sky" }) {
  const toneCls =
    tone === "green"
      ? "text-green-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "red"
          ? "text-red-700"
          : tone === "slate"
            ? "text-slate-500"
            : tone === "sky"
              ? "text-sky-700"
              : "text-foreground";
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
