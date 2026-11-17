"use client";

// HR › Roster: one page for the week's roster, clock-ins, leave, swaps and
// overtime (Gosamē UI Office "Roster" pattern, Celsius brand; owner-approved
// mock 11 Nov 2026, docs/design/backoffice-structure.md step 4).
//
// Built only on existing APIs, so pay and overtime rules are unchanged:
//   - grid: GET /api/hr/schedules/roster-attendance (rostered vs clocked, late,
//     approved leave, per person per day);
//   - Leave to decide and Shift swaps: Approve / Decline in place with the same
//     PATCH calls the Leave and Shift swaps pages make;
//   - Overtime and Clock-ins feed payroll and have partial-approve / excuse /
//     payroll-sync flows, so here they show what waits and "Review" opens the
//     page that decides them.
// The old pages stay until the owner has checked this one against real data.

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { toast, usePrompt } from "@celsius/ui";
import { useFetch } from "@/lib/use-fetch";
import { KeyNumber } from "@/components/ui/key-number";

type Status = "on_time" | "late" | "absent" | "upcoming" | "rest_day" | "no_roster" | "on_leave" | "off";
type Cell = {
  scheduled_start: string | null; scheduled_end: string | null;
  clock_in: string | null; clock_out: string | null;
  clock_in_method: string | null; clock_out_method: string | null;
  total_hours: number | null; overtime_hours: number | null;
  late_minutes: number; open: boolean; status: Status;
};
type Staff = { user_id: string; name: string | null; nickname: string | null; position: string | null; days: Record<string, Cell> };
type Summary = { rostered: number; present: number; late: number; absent: number; upcoming: number; unrostered: number; on_leave: number };
type WeekResp = { mode: "week"; week_start: string; days: string[]; outlet: { id: string; name: string }; staff: Staff[]; summary: Summary };
type LeaveReq = { id: string; user_name: string | null; outlet_name: string | null; leave_type: string; start_date: string; end_date: string; total_days: number; status: string; reason: string | null };
type SwapReq = { id: string; requester_name: string; target_name: string; requester_shift: { shift_date: string; start_time: string; end_time: string } | null; target_shift: { shift_date: string } | null };
type OtReq = { id: string; outlet_id: string; date: string; hours_requested: number; staff: { name?: string | null; fullName?: string | null } | null };

const DAY = 86_400_000;
const TZ = "Asia/Kuala_Lumpur";
const todayMYT = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
const mondayOf = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  const dow = d.getUTCDay();
  return new Date(d.getTime() + (dow === 0 ? -6 : 1 - dow) * DAY).toISOString().slice(0, 10);
};
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const dayHead = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });
const dayWords = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const time12 = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }) : "—");
const hhmm12 = (hm: string | null) => {
  if (!hm) return "";
  const [h, m] = hm.split(":").map(Number);
  const hr = h % 12 || 12;
  return m ? `${hr}:${String(m).padStart(2, "0")}` : `${hr}`;
};
const shiftText = (c: Cell) => (c.scheduled_start ? `${hhmm12(c.scheduled_start)} – ${hhmm12(c.scheduled_end)}` : "");
const short = (s: Staff) => s.nickname || s.name || "Someone";
const initials = (s: Staff) => short(s).split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

// Cell look per status (Celsius UI: problems are an outline + sign, never a fill).
const CELL: Record<Status, { box: string; label: (c: Cell) => string; sub: (c: Cell) => string }> = {
  on_time: { box: "bg-ok-soft text-ok-text", label: (c) => `In ${time12(c.clock_in)}`, sub: (c) => (c.open ? "on now" : shiftText(c)) },
  late: { box: "bg-surface text-text shadow-[inset_0_0_0_1.5px_var(--danger)]", label: (c) => `In ${time12(c.clock_in)}`, sub: (c) => `! ${c.late_minutes} min late` },
  absent: { box: "bg-surface text-danger-text shadow-[inset_0_0_0_1.5px_var(--danger)]", label: () => "Did not come", sub: (c) => shiftText(c) },
  upcoming: { box: "bg-sunken text-text", label: (c) => shiftText(c), sub: () => "rostered" },
  rest_day: { box: "text-text-3", label: () => "Rest day", sub: () => "" },
  no_roster: { box: "bg-info-soft text-info-text", label: (c) => `In ${time12(c.clock_in)}`, sub: () => "not rostered" },
  on_leave: { box: "bg-info-soft text-info-text", label: () => "Leave", sub: () => "approved" },
  off: { box: "text-text-3", label: () => "—", sub: () => "" },
};

export default function RosterPage() {
  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");
  const outlets = scheduleList?.outlets ?? [];
  const [picked, setPicked] = useState("");
  const outletId = picked || outlets[0]?.id || "";
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayMYT()));
  const [sel, setSel] = useState<{ uid: string; day: string } | null>(null);

  const { data, isLoading } = useFetch<WeekResp>(
    outletId ? `/api/hr/schedules/roster-attendance?outlet_id=${outletId}&week_start=${weekStart}` : null,
  );
  const { data: leave, mutate: mutateLeave } = useFetch<{ requests: LeaveReq[] }>("/api/hr/leave?status=all");
  const { data: swaps, mutate: mutateSwaps } = useFetch<{ requests: SwapReq[] }>("/api/hr/shift-swaps?status=pending_approval");
  const { data: ot } = useFetch<{ requests: OtReq[] }>("/api/hr/overtime-requests?status=pending");
  const { data: att } = useFetch<{ summary?: { pending?: number; pendingOtHours?: number } }>("/api/hr/attendance?review=pending");

  const outletName = data?.outlet.name ?? outlets.find((o) => o.id === outletId)?.name ?? "";
  const leaveToDecide = (leave?.requests ?? []).filter(
    (r) => (r.status === "pending" || r.status === "ai_escalated") && (!outletName || !r.outlet_name || r.outlet_name === outletName),
  );
  const otHere = (ot?.requests ?? []).filter((r) => !outletId || r.outlet_id === outletId);
  const today = todayMYT();
  const days = data?.days ?? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const staff = useMemo(() => data?.staff ?? [], [data]);
  const s = data?.summary;
  const onTimePct = s && s.present ? Math.round(((s.present - s.late) / s.present) * 100) : null;
  const todayCells = days.includes(today) ? staff.map((p) => ({ p, c: p.days[today] })) : [];
  const notInYet = todayCells.filter(({ c }) => c?.status === "absent");
  const inNow = todayCells.filter(({ c }) => c?.open);
  const selected = sel ? staff.find((p) => p.user_id === sel.uid) : undefined;
  const selCell = selected && sel ? selected.days[sel.day] : undefined;

  const { prompt, PromptDialog } = usePrompt();
  const [busy, setBusy] = useState<string | null>(null);
  const call = async (key: string, url: string, body: object, ok: string) => {
    setBusy(key);
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      if (!res.ok) { toast.error(j?.error ?? `Failed (${res.status}) — nothing was changed.`); return false; }
      toast.success(ok);
      return true;
    } catch {
      toast.error("Network error — nothing was changed.");
      return false;
    } finally {
      setBusy(null);
    }
  };
  const decideLeave = async (r: LeaveReq, action: "approve" | "reject") => {
    if (await call(`leave:${r.id}`, "/api/hr/leave", { id: r.id, action }, action === "approve" ? "Leave approved" : "Leave declined")) mutateLeave();
  };
  const decideSwap = async (r: SwapReq, action: "approve" | "reject") => {
    let rejection_reason: string | null = null;
    if (action === "reject") {
      rejection_reason = await prompt({ title: "Why decline this swap?", description: "Shown to the staff who asked.", placeholder: "e.g. not enough cover on Tue evening", required: true });
      if (rejection_reason === null) return;
    }
    if (await call(`swap:${r.id}`, "/api/hr/shift-swaps", { swap_id: r.id, action, rejection_reason }, action === "approve" ? "Swap approved — shifts updated" : "Swap declined")) mutateSwaps();
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 pt-6 pb-10 md:px-8">
      <PromptDialog />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">
            {outletName || "Roster"} · {dayWords(weekStart)} – {dayWords(addDays(weekStart, 6))}
          </p>
          <h1 className="mt-1 text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">Roster</h1>
          <p className="mt-1.5 text-sm text-text-2">The week&apos;s shifts, who came, and what waits on you, in one place.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={outletId}
            onChange={(e) => { setPicked(e.target.value); setSel(null); }}
            aria-label="Outlet"
            className="h-8 rounded-ctl border border-line-2 bg-raised px-2.5 text-[13px] text-text max-md:h-11"
          >
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <div className="flex h-8 items-center rounded-ctl border border-line-2 bg-raised max-md:h-11">
            <button type="button" onClick={() => { setWeekStart((w) => addDays(w, -7)); setSel(null); }} aria-label="Previous week" className="flex h-full w-8 items-center justify-center text-text-2 hover:text-text max-md:w-11"><ChevronLeft className="size-4" /></button>
            <button type="button" onClick={() => { setWeekStart(mondayOf(todayMYT())); setSel(null); }} className="px-1.5 text-[13px] text-text">
              {weekStart === mondayOf(today) ? "This week" : weekStart === addDays(mondayOf(today), 7) ? "Next week" : weekStart === addDays(mondayOf(today), -7) ? "Last week" : dayWords(weekStart)}
            </button>
            <button type="button" onClick={() => { setWeekStart((w) => addDays(w, 7)); setSel(null); }} aria-label="Next week" className="flex h-full w-8 items-center justify-center text-text-2 hover:text-text max-md:w-11"><ChevronRight className="size-4" /></button>
          </div>
          <Link href="/hr/schedules" className="inline-flex h-8 items-center rounded-ctl bg-ink px-3 text-[13px] font-medium text-on-ink hover:bg-ink-hover max-md:h-11">Edit the roster</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KeyNumber label="On time" value={onTimePct == null ? "–" : `${onTimePct}%`} note={s ? `${s.present - s.late} of ${s.present} shifts worked` : ""} />
        <KeyNumber label="Late" value={s ? String(s.late) : null} note="after the grace period" tone={s && s.late ? "warn" : undefined} />
        <KeyNumber label="Did not come" value={s ? String(s.absent) : null} note="rostered, no clock-in" tone={s && s.absent ? "warn" : undefined} />
        <KeyNumber label="On leave" value={s ? String(s.on_leave) : null} note={`${leaveToDecide.length} leave to decide`} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="This week" className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3.5 pb-3 text-xs text-text-2">
            <Key cls="bg-ok-soft" label="On time" />
            <Key cls="bg-surface shadow-[inset_0_0_0_1.5px_var(--danger)]" label="Late or did not come" />
            <Key cls="bg-sunken" label="Rostered" />
            <Key cls="bg-info-soft" label="Leave or not rostered" />
          </div>
          {isLoading || !outletId ? (
            <p className="flex items-center justify-center gap-2 border-t border-line py-14 text-sm text-text-2"><Loader2 className="size-4 animate-spin" aria-hidden /> Loading the week…</p>
          ) : staff.length === 0 ? (
            <p className="border-t border-line py-14 text-center text-sm text-text-2">No one is rostered or clocked in at {outletName} this week. <Link href="/hr/schedules" className="font-medium text-text underline">Build the roster</Link></p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[13px]">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border-y border-line bg-sunken px-4 py-2 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-text-3">Person</th>
                    {days.map((d) => (
                      <th key={d} className={"border-y border-line px-1 py-2 text-center font-mono text-[11px] font-semibold uppercase tracking-[0.06em] " + (d === today ? "bg-brand-soft text-brand-text" : "bg-sunken text-text-3")}>
                        {dayHead(d)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((p) => (
                    <tr key={p.user_id}>
                      <td className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-text">{initials(p)}</span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-text">{short(p)}</p>
                            {p.position && <p className="truncate text-[11px] text-text-3">{p.position}</p>}
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const c = p.days[d];
                        if (!c) return <td key={d} className="border-b border-line" />;
                        const look = CELL[c.status];
                        const isSel = sel?.uid === p.user_id && sel.day === d;
                        return (
                          <td key={d} className={"border-b border-line p-1 " + (d === today ? "bg-brand-soft/40" : "")}>
                            <button
                              type="button"
                              onClick={() => setSel(isSel ? null : { uid: p.user_id, day: d })}
                              aria-label={`${short(p)}, ${dayWords(d)}: ${look.label(c)}`}
                              className={"flex h-[42px] w-full flex-col items-center justify-center rounded-ctl px-1 text-center leading-tight " + look.box + (isSel ? " outline outline-2 outline-offset-1 outline-text" : "")}
                            >
                              <span className="truncate text-xs font-semibold">{look.label(c)}</span>
                              {look.sub(c) && <span className="truncate text-[11px] opacity-80">{look.sub(c)}</span>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-4">
          {selected && selCell && sel && (
            <SideCard title={`${short(selected)} · ${dayWords(sel.day)}`}>
              <div className="space-y-1.5 border-t border-line px-4 py-3 text-[13px]">
                <Row k="Rostered" v={shiftText(selCell) || "Not rostered"} />
                <Row k="Clocked" v={selCell.clock_in ? `${time12(selCell.clock_in)} – ${selCell.clock_out ? time12(selCell.clock_out) : "still in"}` : "No clock-in"} />
                {selCell.clock_in_method && <Row k="How" v={selCell.clock_in_method.replace(/_/g, " ")} />}
                {selCell.late_minutes > 0 && <Row k="Late" v={`${selCell.late_minutes} min`} />}
                {selCell.overtime_hours ? <Row k="Overtime" v={`${selCell.overtime_hours} h`} /> : null}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                <Link href="/hr/attendance" className="inline-flex h-8 items-center rounded-ctl bg-ink px-3 text-xs font-medium text-on-ink hover:bg-ink-hover">Review in Attendance</Link>
                <Link href="/hr/schedules" className="inline-flex h-8 items-center rounded-ctl border border-line-2 px-3 text-xs font-medium text-text hover:bg-sunken">Change the shift</Link>
              </div>
            </SideCard>
          )}

          {days.includes(today) && (
            <SideCard title="Today" badge={dayWords(today)}>
              <Line icon={<CheckCircle2 className="size-4 text-ok-text" aria-hidden />} title={`${inNow.length} in now`} meta={inNow.map(({ p }) => short(p)).join(", ") || "No one clocked in yet"} />
              {notInYet.length > 0 && (
                <Line icon={<AlertTriangle className="size-4 text-danger-text" aria-hidden />} title={`${notInYet.length} did not come`} meta={notInYet.map(({ p }) => short(p)).join(", ")} />
              )}
            </SideCard>
          )}

          <SideCard title="Leave to decide" badge={leaveToDecide.length ? String(leaveToDecide.length) : undefined}>
            {leaveToDecide.length === 0 ? <Empty text="No leave waits on you." /> : leaveToDecide.slice(0, 6).map((r) => (
              <Line
                key={r.id}
                title={`${r.user_name ?? "Someone"} · ${r.leave_type.replace(/_/g, " ")}, ${r.total_days} day${r.total_days === 1 ? "" : "s"}`}
                meta={`${dayWords(r.start_date)}${r.end_date !== r.start_date ? ` – ${dayWords(r.end_date)}` : ""}${r.reason ? ` · ${r.reason}` : ""}`}
                actions={<>
                  <Btn ink busy={busy === `leave:${r.id}`} onClick={() => decideLeave(r, "approve")}>Approve</Btn>
                  <Btn busy={busy === `leave:${r.id}`} onClick={() => decideLeave(r, "reject")}>Decline</Btn>
                </>}
              />
            ))}
            {leaveToDecide.length > 6 && <Foot href="/hr/leave" label={`All ${leaveToDecide.length} leave requests`} />}
          </SideCard>

          {(swaps?.requests?.length ?? 0) > 0 && (
            <SideCard title="Shift swaps" badge={String(swaps!.requests.length)}>
              {swaps!.requests.slice(0, 5).map((r) => (
                <Line
                  key={r.id}
                  title={`${r.requester_name} with ${r.target_name}`}
                  meta={r.requester_shift ? `${dayWords(r.requester_shift.shift_date)}${r.target_shift ? ` ↔ ${dayWords(r.target_shift.shift_date)}` : ""} · both agreed` : "Both agreed"}
                  actions={<>
                    <Btn ink busy={busy === `swap:${r.id}`} onClick={() => decideSwap(r, "approve")}>Approve</Btn>
                    <Btn busy={busy === `swap:${r.id}`} onClick={() => decideSwap(r, "reject")}>Decline</Btn>
                  </>}
                />
              ))}
            </SideCard>
          )}

          <SideCard title="Overtime to approve" badge={otHere.length ? String(otHere.length) : undefined}>
            {otHere.length === 0 ? <Empty text="No overtime waits on you." /> : otHere.slice(0, 5).map((r) => (
              <Line key={r.id} icon={<Clock className="size-4 text-warn-text" aria-hidden />} title={`${r.staff?.name || r.staff?.fullName || "Someone"} · ${r.hours_requested} h`} meta={dayWords(r.date)} />
            ))}
            {otHere.length > 0 && <Foot href="/hr/overtime" label="Review overtime (feeds payroll)" />}
          </SideCard>

          <SideCard title="Clock-ins to check" badge={att?.summary?.pending ? String(att.summary.pending) : undefined}>
            {att?.summary?.pending ? (
              <>
                <Line icon={<Clock className="size-4 text-warn-text" aria-hidden />} title={`${att.summary.pending} clock-in${att.summary.pending === 1 ? "" : "s"} to review`} meta={att.summary.pendingOtHours ? `${att.summary.pendingOtHours} h of overtime inside` : "Approving a day also approves its overtime"} />
                <Foot href="/hr/attendance" label="Review clock-ins" />
              </>
            ) : <Empty text="Every clock-in is checked." />}
          </SideCard>
        </div>
      </div>
    </div>
  );
}

function Key({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className={"inline-block h-2.5 w-3.5 rounded-[3px] " + cls} />{label}</span>;
}
function SideCard({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-card border border-line bg-surface">
      <h2 className="flex items-center gap-2 px-4 pt-3.5 pb-2.5 text-base font-semibold text-text">
        {title}
        {badge && <span className="rounded-full bg-warn-soft px-2 text-xs font-medium leading-5 text-warn-text">{badge}</span>}
      </h2>
      {children}
    </section>
  );
}
function Line({ icon, title, meta, actions }: { icon?: React.ReactNode; title: string; meta: string; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-4 py-2.5 max-sm:flex-wrap">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-[18px] text-text">{title}</p>
        <p className="mt-0.5 text-xs text-text-3">{meta}</p>
      </div>
      {actions && <div className="flex shrink-0 gap-1.5">{actions}</div>}
    </div>
  );
}
function Btn({ ink, busy, onClick, children }: { ink?: boolean; busy?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={"inline-flex h-8 items-center rounded-ctl px-2.5 text-xs font-medium disabled:opacity-50 max-md:h-11 max-md:px-3.5 " + (ink ? "bg-ink text-on-ink hover:bg-ink-hover" : "border border-line-2 text-text hover:bg-sunken")}
    >
      {children}
    </button>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><span className="text-text-3">{k}</span><span className="text-right font-mono text-text tabular-nums">{v}</span></div>;
}
function Empty({ text }: { text: string }) {
  return <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-[13px] text-text-2"><CheckCircle2 className="size-4 text-ok-text" aria-hidden />{text}</p>;
}
function Foot({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="flex min-h-10 items-center gap-1 border-t border-line px-4 text-[13px] font-medium text-text hover:bg-sunken/60">
      {label} <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}
