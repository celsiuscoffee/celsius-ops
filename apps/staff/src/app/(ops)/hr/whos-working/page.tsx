"use client";

import { useState } from "react";
import { HRPageHeader } from "@/components/hr-page-header";
import { useFetch } from "@/lib/use-fetch";
import { Users, Loader2 } from "lucide-react";
import { formatClock } from "@/lib/format-time";

// Mirrors the native "Who's Working" screen. Backend is the shared PWA endpoint
// /api/hr/whos-working?date=YYYY-MM-DD → { date, team }, scoped to the caller's
// outlet, published schedules only.
type TeamMate = {
  user_id: string;
  name: string;
  position: string | null;
  start_time: string;
  end_time: string;
  is_me: boolean;
};

// Seven day-chips from today (MYT). The key is the YYYY-MM-DD the API expects;
// weekday/day are read off a UTC-anchored date so they never roll over a TZ edge.
function buildDays() {
  const todayMyt = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const [y, m, d] = todayMyt.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(base + i * 86_400_000);
    const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    return {
      key,
      weekday: dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      day: String(dt.getUTCDate()),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : null,
    };
  });
}

const DAYS = buildDays();

// Guard against schema drift (null names/times) — a render throw here would
// otherwise blank the whole screen.
function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "?";
}

function fmtTime(t: string | null | undefined): string {
  const [h, m] = (t ?? "").split(":");
  const hn = Number(h);
  const mn = Number(m);
  if (!Number.isFinite(hn) || !Number.isFinite(mn) || h === "" || m == null) return "-";
  return formatClock(`${hn}:${String(mn).padStart(2, "0")}`);
}

export default function WhosWorkingPage() {
  const [selected, setSelected] = useState(DAYS[0].key);
  const { data, isLoading } = useFetch<{ date: string; team: TeamMate[] }>(
    `/api/hr/whos-working?date=${selected}`,
  );
  const team = data?.team ?? [];
  const label = DAYS.find((x) => x.key === selected)?.label ?? null;
  const suffix = label ? ` ${label.toLowerCase()}` : "";

  return (
    <div className="px-4 pt-6 pb-8">
      {/* Header */}
      <HRPageHeader title="Who's working" subtitle="Who is on shift with you each day." />

      {/* Day picker */}
      <div className="-mx-4 mb-4 overflow-x-auto px-4">
        <div className="flex gap-2">
          {DAYS.map((x) => {
            const on = x.key === selected;
            return (
              <button
                key={x.key}
                onClick={() => setSelected(x.key)}
                className={`flex w-14 shrink-0 flex-col items-center rounded-2xl border py-2 transition-colors active:opacity-80 ${
                  on ? "border-ink bg-ink text-on-ink" : "border-line bg-surface text-text-2"
                }`}
              >
                <span className={`text-[11px] font-semibold uppercase ${on ? "text-on-ink/80" : "text-text-3"}`}>
                  {x.weekday}
                </span>
                <span className="text-lg font-bold">{x.day}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-text" />
        </div>
      ) : team.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft">
            <Users className="h-6 w-6 text-brand-text" />
          </div>
          <p className="font-semibold">No one scheduled{suffix}</p>
          <p className="mt-1 text-sm text-text-3">
            Once the schedule is published, your team&apos;s shifts show up here.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-text-3">
            {team.length} on shift{suffix}
          </p>
          <div className="space-y-2.5">
            {team.map((m, i) => (
              <div
                key={`${m.user_id}-${i}`}
                className={`flex items-center gap-3 rounded-2xl border p-4 ${
                  m.is_me ? "border-brand/40 bg-brand-soft" : "border-line bg-surface"
                }`}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-base font-bold text-brand-text">
                  {initials(m.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold">{m.name}</p>
                    {m.is_me && (
                      <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold text-on-ink">You</span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text-3">
                      {fmtTime(m.start_time)} - {fmtTime(m.end_time)}
                    </span>
                    {m.position && (
                      <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-text">
                        {m.position}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
