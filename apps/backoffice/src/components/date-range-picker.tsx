"use client";

// Single-calendar date-range picker. Click the start day then the end day in
// ONE calendar — no two separate date inputs, no choosing the date twice.
// Dates are plain "YYYY-MM-DD" strings (calendar dates, timezone-agnostic).
// Reuse this for EVERY custom date range across the app.

import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["M", "T", "W", "T", "F", "S", "S"];

function parse(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
}
const fmt = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
function label(s: string): string {
  const p = parse(s);
  return p ? `${p.d} ${MONTHS[p.m]} ${p.y}` : "";
}
function todayStr(): string {
  const t = new Date(Date.now() + 8 * 3600_000); // MYT
  return t.toISOString().slice(0, 10);
}

export function DateRangePicker({
  start, end, onChange, className, size = "sm",
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  className?: string;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // start of an in-progress selection
  const [hover, setHover] = useState<string | null>(null);
  const init = parse(start) ?? parse(todayStr())!;
  const [view, setView] = useState<{ y: number; m: number }>({ y: init.y, m: init.m });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setPending(null); }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Range currently shown as selected/preview.
  const lo = pending ? (hover && hover < pending ? hover : pending) : start;
  const hi = pending ? (hover && hover > pending ? hover : pending) : end;

  function pickDay(ds: string) {
    if (!pending) { setPending(ds); setHover(ds); return; }
    if (ds >= pending) { onChange(pending, ds); setPending(null); setHover(null); setOpen(false); }
    else { setPending(ds); setHover(ds); } // clicked earlier than start → restart from there
  }

  // Build the visible month grid (Mon-first), with leading blanks.
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const today = todayStr();

  const h = size === "xs" ? "h-7 text-xs" : "h-8 text-sm";
  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={`flex ${h} items-center gap-1.5 rounded-md border bg-background px-2 text-foreground hover:bg-muted/40`}>
        <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
        {start && end ? <span className="tabular-nums">{label(start)} → {label(end)}</span> : <span className="text-muted-foreground">Select dates</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border bg-card p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setView((v) => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 })}
              className="rounded p-1 hover:bg-muted/50"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-medium">{MONTHS[view.m]} {view.y}</span>
            <button type="button" onClick={() => setView((v) => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })}
              className="rounded p-1 hover:bg-muted/50"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DOW.map((d, i) => <div key={i} className="py-1 text-[10px] font-medium text-muted-foreground">{d}</div>)}
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const ds = fmt(view.y, view.m, day);
              const inRange = lo && hi && ds >= lo && ds <= hi;
              const isEdge = ds === lo || ds === hi;
              const isToday = ds === today;
              return (
                <button key={i} type="button"
                  onClick={() => pickDay(ds)}
                  onMouseEnter={() => pending && setHover(ds)}
                  className={`py-1 text-xs tabular-nums rounded transition-colors ${
                    isEdge ? "bg-terracotta text-white font-semibold"
                    : inRange ? "bg-terracotta/15 text-foreground"
                    : "hover:bg-muted/60"} ${isToday && !isEdge ? "ring-1 ring-terracotta/40" : ""}`}>
                  {day}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2 text-[11px]">
            <button type="button" onClick={() => { const t = today; onChange(t, t); setPending(null); setOpen(false); }}
              className="text-terracotta hover:underline">Today</button>
            {pending
              ? <span className="text-muted-foreground">Pick the end date…</span>
              : <span className="text-muted-foreground tabular-nums">{start && end ? `${label(start)} → ${label(end)}` : ""}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
