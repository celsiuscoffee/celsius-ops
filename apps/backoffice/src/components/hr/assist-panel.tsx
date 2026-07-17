"use client";

// Schedule Assist panel — the fit-ranking flow (coverage picture → shift window
// → ranked candidates → assign, with the override/training log). Extracted from
// the standalone /schedule-assist page so the SAME panel embeds inside the
// Schedules grid (per-day modal): assist happens DURING scheduling, not on a
// separate tab. The standalone page now wraps this component too.

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { Users, Sparkles, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";

type Template = { id: string; label: string; start_time: string; end_time: string; break_minutes: number };
type CoverageSlot = { slot_start: string; slot_end: string; min_staff: number; concurrent: number; gap: number };
type Signals = { reliability: number; availability: number; fairness: number; skill: number; home: number };
export type AssistCandidate = {
  user_id: string;
  name: string | null;
  position: string | null;
  employment_type: string;
  fit_score: number;
  weekly_hours: number;
  weekly_hours_after: number;
  signals: Signals;
  hard_blocks: string[];
};
type Weights = Record<string, number>;
type Resp = {
  outlet: { id: string; name: string; open: string; close: string };
  date: string;
  weekday: number;
  week_start: string;
  coverage: CoverageSlot[];
  assigned_headcount: number;
  has_coverage_rule: boolean;
  templates: Template[];
  weights: Weights;
  slot?: { start: string; end: string; role: string | null; hours: number };
  candidates: AssistCandidate[] | null;
};

const BLOCK_LABEL: Record<string, string> = {
  double_booked: "Already on a shift",
  on_leave: "On leave",
  rest_day: "Rest day",
  over_cap: "Over 45h cap",
  unavailable: "Marked unavailable",
  pt_unavailable: "Outside declared availability",
};

const EMP_LABEL: Record<string, string> = {
  full_time: "FT",
  part_time: "PT",
  intern: "Intern",
};

export function AssistPanel({
  outletId,
  date,
  autoPickGap = false,
  onAssigned,
}: {
  outletId: string;
  date: string;
  // Embedded (grid) usage: pre-select the day's first coverage-gap window so
  // the manager lands straight on a ranked list for the hole they clicked.
  autoPickGap?: boolean;
  onAssigned?: () => void;
}) {
  const [slot, setSlot] = useState<{ start: string; end: string } | null>(null);
  const [role, setRole] = useState("");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [gapPicked, setGapPicked] = useState(false);

  // Changing outlet/date invalidates the picked slot.
  useEffect(() => {
    setSlot(null);
    setGapPicked(false);
    setFlash(null);
  }, [outletId, date]);

  const slotQs = slot ? `&start=${slot.start}&end=${slot.end}${role ? `&role=${encodeURIComponent(role)}` : ""}` : "";
  const url = outletId && date ? `/api/hr/schedules/candidates?outlet_id=${outletId}&date=${date}${slotQs}` : null;
  const { data, isLoading, mutate } = useFetch<Resp>(url);

  const templates = data?.templates || [];
  const coverage = data?.coverage || [];
  const totalGap = coverage.reduce((a, c) => a + c.gap, 0);

  // Grid-embedded flow: jump straight to the first under-covered window.
  useEffect(() => {
    if (!autoPickGap || gapPicked || slot || !data) return;
    const gap = coverage.find((c) => c.gap > 0);
    if (gap) setSlot({ start: gap.slot_start, end: gap.slot_end });
    setGapPicked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPickGap, gapPicked, slot, data]);

  const pickTemplate = (t: Template) => setSlot({ start: t.start_time, end: t.end_time });
  const pickCustom = () => {
    if (/^\d{2}:\d{2}$/.test(customStart) && /^\d{2}:\d{2}$/.test(customEnd) && customStart < customEnd) {
      setSlot({ start: customStart, end: customEnd });
    }
  };

  async function assign(c: AssistCandidate) {
    if (!data || !slot) return;
    const candidates = data.candidates || [];
    const eligible = candidates.filter((x) => x.hard_blocks.length === 0);
    const top = eligible[0] || candidates[0];
    const rank = candidates.findIndex((x) => x.user_id === c.user_id) + 1;
    const isOverride = !!top && top.user_id !== c.user_id;

    let overrideReason: string | null = null;
    if (isOverride) {
      overrideReason = window.prompt(
        `${c.name || "This staffer"} isn't the top-ranked pick (${top?.name || "another staffer"} scored higher). Why choose them? (optional — helps train auto-scheduling)`,
        "",
      );
      // Cancelled prompt → abort the whole assignment.
      if (overrideReason === null) return;
    }
    if (c.hard_blocks.length > 0) {
      const ok = window.confirm(
        `${c.name || "This staffer"} has a hard block: ${c.hard_blocks.map((b) => BLOCK_LABEL[b] || b).join(", ")}. Assign anyway?`,
      );
      if (!ok) return;
    }

    setAssigning(c.user_id);
    setFlash(null);
    try {
      const template = templates.find((t) => t.start_time === slot.start && t.end_time === slot.end);
      const res = await fetch("/api/hr/schedules/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: outletId,
          shift_date: date,
          user_id: c.user_id,
          start_time: slot.start,
          end_time: slot.end,
          break_minutes: template?.break_minutes ?? 30,
          role_type: role || c.position || null,
          assigned_fit_rank: rank,
          assigned_fit_score: c.fit_score,
          top_candidate_user_id: top?.user_id ?? null,
          top_candidate_fit_score: top?.fit_score ?? null,
          override_reason: overrideReason,
          candidate_snapshot: { weights: data.weights, slot, role: role || null, candidates },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Assign failed (${res.status})`);
      }
      setFlash({ kind: "ok", text: `${c.name || "Staff"} assigned to ${slot.start}–${slot.end}.` });
      setSlot(null);
      mutate();
      onAssigned?.();
    } catch (e) {
      setFlash({ kind: "err", text: e instanceof Error ? e.message : "Assign failed" });
    } finally {
      setAssigning(null);
    }
  }

  return (
    <div className="space-y-4">
      {flash && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm ${flash.kind === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {flash.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {flash.text}
        </div>
      )}

      {/* Coverage picture */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Coverage · {new Date(date + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "short" })}</h2>
          <span className="text-xs text-muted-foreground">{data?.assigned_headcount ?? 0} rostered</span>
        </div>
        {!data?.has_coverage_rule ? (
          <p className="text-sm text-muted-foreground">No coverage rule set for this day. Assign against your own judgement, or set targets under Coverage Rules.</p>
        ) : coverage.length === 0 ? (
          <p className="text-sm text-muted-foreground">No coverage slots for this weekday.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {coverage.map((c, i) => (
              <button
                key={i}
                onClick={() => setSlot({ start: c.slot_start, end: c.slot_end })}
                className={`rounded-lg border px-3 py-2 text-left text-xs ${c.gap > 0 ? "border-red-200 bg-red-50 hover:border-red-300" : "border-green-200 bg-green-50 hover:border-green-300"}`}
                title="Rank candidates for this window"
              >
                <div className="font-medium tabular-nums">{c.slot_start}–{c.slot_end}</div>
                <div className={c.gap > 0 ? "text-red-700" : "text-green-700"}>
                  {c.concurrent}/{c.min_staff} staff{c.gap > 0 ? ` · short ${c.gap}` : " · covered"}
                </div>
              </button>
            ))}
            {totalGap > 0 && (
              <div className="flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> {totalGap} slot-gap{totalGap > 1 ? "s" : ""} to fill
              </div>
            )}
          </div>
        )}
      </section>

      {/* Shift window picker */}
      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Shift to fill</h2>
        <div className="flex flex-wrap items-center gap-2">
          {templates.map((t) => {
            const active = slot?.start === t.start_time && slot?.end === t.end_time;
            return (
              <button
                key={t.id}
                onClick={() => pickTemplate(t)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${active ? "border-terracotta bg-terracotta text-white" : "hover:bg-muted"}`}
              >
                {t.label} <span className="opacity-70">{t.start_time}–{t.end_time}</span>
              </button>
            );
          })}
          <div className="flex items-center gap-1 rounded-lg border px-2 py-1 text-sm">
            <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-24 bg-transparent" aria-label="Custom start" />
            <span className="text-muted-foreground">–</span>
            <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-24 bg-transparent" aria-label="Custom end" />
            <button onClick={pickCustom} className="ml-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium hover:bg-muted/70">Use</button>
          </div>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Role (optional, e.g. Barista)"
            className="rounded-lg border bg-card px-3 py-1.5 text-sm"
          />
        </div>
        {slot && (
          <p className="mt-3 text-xs text-muted-foreground">
            Ranking for <span className="font-medium text-foreground">{slot.start}–{slot.end}</span>
            {role && <> · {role}</>}
          </p>
        )}
      </section>

      {/* Candidate ranking */}
      {!slot ? (
        <Empty title="Pick a shift window" body="Choose a template, a coverage slot, or a custom time to see who fits best." icon={Sparkles} />
      ) : isLoading || !data ? (
        <Empty title="Ranking…" body="" icon={Sparkles} />
      ) : (
        <CandidateList candidates={data.candidates || []} weights={data.weights} onAssign={assign} assigning={assigning} />
      )}
    </div>
  );
}

function CandidateList({
  candidates,
  weights,
  onAssign,
  assigning,
}: {
  candidates: AssistCandidate[];
  weights: Weights;
  onAssign: (c: AssistCandidate) => void;
  assigning: string | null;
}) {
  const eligible = candidates.filter((c) => c.hard_blocks.length === 0);
  const blocked = candidates.filter((c) => c.hard_blocks.length > 0);
  const topId = eligible[0]?.user_id;

  if (candidates.length === 0) return <Empty title="No staff in pool" body="No schedulable staff found for this outlet." icon={Users} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{eligible.length} eligible</span>
        {blocked.length > 0 && <span>· {blocked.length} blocked</span>}
        <span className="ml-auto hidden sm:inline">
          Weights: reliability {weights.reliability} · availability {weights.availability} · fairness {weights.fairness} · skill {weights.skill}
        </span>
      </div>
      {eligible.map((c, i) => (
        <CandidateRow key={c.user_id} c={c} rank={i + 1} isTop={c.user_id === topId} onAssign={onAssign} busy={assigning === c.user_id} />
      ))}
      {blocked.length > 0 && (
        <>
          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Blocked</div>
          {blocked.map((c) => (
            <CandidateRow key={c.user_id} c={c} rank={null} isTop={false} onAssign={onAssign} busy={assigning === c.user_id} />
          ))}
        </>
      )}
    </div>
  );
}

function CandidateRow({
  c,
  rank,
  isTop,
  onAssign,
  busy,
}: {
  c: AssistCandidate;
  rank: number | null;
  isTop: boolean;
  onAssign: (c: AssistCandidate) => void;
  busy: boolean;
}) {
  void rank;
  const blocked = c.hard_blocks.length > 0;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 shadow-sm ${blocked ? "border-gray-200 bg-gray-50/60" : isTop ? "border-terracotta/40 bg-terracotta/5" : "bg-card"}`}>
      {/* Fit score */}
      <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg border bg-card">
        <span className={`text-lg font-bold tabular-nums ${blocked ? "text-muted-foreground" : "text-foreground"}`}>{c.fit_score}</span>
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">fit</span>
      </div>

      {/* Identity */}
      <div className="min-w-[8rem] flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{c.name || c.user_id.slice(0, 8) + "…"}</span>
          {isTop && !blocked && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-terracotta/10 px-1.5 py-0.5 text-[10px] font-semibold text-terracotta">
              <Sparkles className="h-2.5 w-2.5" /> Top pick
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{EMP_LABEL[c.employment_type] || c.employment_type}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {c.position || "—"} · {c.weekly_hours}h this week → {c.weekly_hours_after}h
        </div>
      </div>

      {/* Signal chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {blocked ? (
          c.hard_blocks.map((b) => (
            <span key={b} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
              <ShieldAlert className="h-2.5 w-2.5" /> {BLOCK_LABEL[b] || b}
            </span>
          ))
        ) : (
          <>
            <Signal label="reliable" value={c.signals.reliability} />
            <Signal label="avail" value={c.signals.availability} />
            <Signal label="fair" value={c.signals.fairness} />
            <Signal label="skill" value={c.signals.skill} />
          </>
        )}
      </div>

      {/* Assign */}
      <button
        onClick={() => onAssign(c)}
        disabled={busy}
        className={`ml-auto shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${blocked ? "border bg-card hover:bg-muted" : "bg-terracotta text-white hover:bg-terracotta/90"}`}
      >
        {busy ? "Assigning…" : blocked ? "Assign anyway" : "Assign"}
      </button>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? "text-green-700" : value >= 0.55 ? "text-amber-700" : "text-red-700";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums ${tone}`}>{pct}</span>
    </span>
  );
}

function Empty({ title, body, icon: Icon = Users }: { title: string; body: string; icon?: typeof Users }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
      <Icon className="mb-3 h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}
