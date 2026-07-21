"use client";

import { useFetch } from "@/lib/use-fetch";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, MapPin, MapPinOff, Clock, Timer, Loader2, ImageOff, PencilLine, Smartphone, Hand, WifiOff } from "lucide-react";
import { usePrompt } from "@celsius/ui";
import { HrPageHeader } from "@/components/hr/page-header";
import type { AttendanceLog } from "@/lib/hr/types";

type EnrichedLog = AttendanceLog & {
  user_name: string | null;
  user_nickname: string | null;
  outlet_name: string | null;
  late_minutes: number;
  clock_in_distance_m: number | null;
  clock_out_distance_m: number | null;
  geofence_radius_m: number | null;
};

const timeMyt = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" });

// Minutes → "1h 05m" / "45m" for readable lateness.
const fmtMins = (m: number) => {
  const a = Math.abs(m);
  return a >= 60 ? `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m` : `${a}m`;
};

const CLOCK_METHOD: Record<string, { label: string; icon: typeof Smartphone; color: string }> = {
  app: { label: "GPS", icon: Smartphone, color: "text-gray-500" },
  app_nogps: { label: "No GPS", icon: WifiOff, color: "text-amber-600" },
  app_offsite: { label: "Off-site", icon: MapPinOff, color: "text-red-600" },
  manual: { label: "Manual", icon: Hand, color: "text-blue-600" },
  pos: { label: "POS", icon: Smartphone, color: "text-gray-500" },
  system: { label: "Auto", icon: Timer, color: "text-gray-500" },
};

// A single clock punch's location chip: distance vs the geofence radius, with a
// maps link. Green if inside the allowed radius, red if outside, grey if no GPS.
function GeoChip({ label, lat, lng, distance, radius }: {
  label: string;
  lat: number | null;
  lng: number | null;
  distance: number | null;
  radius: number | null;
}) {
  if (lat == null || lng == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
        <MapPinOff className="h-3 w-3" /> {label}: no GPS
      </span>
    );
  }
  const outside = distance != null && radius != null && distance > radius;
  const cls = outside ? "text-red-600 bg-red-50" : distance != null ? "text-green-700 bg-green-50" : "text-gray-600 bg-gray-50";
  return (
    <a
      href={`https://maps.google.com/?q=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium hover:underline ${cls}`}
      title="Open in Google Maps"
    >
      <MapPin className="h-3 w-3" />
      {label}: {distance != null ? `${distance}m` : "located"}
      {outside && radius != null ? ` · outside ${radius}m zone` : distance != null && radius != null ? " · in zone" : ""}
    </a>
  );
}

const FLAG_LABELS: Record<string, { label: string; icon: typeof AlertTriangle; color: string }> = {
  outside_geofence: { label: "Outside zone", icon: MapPinOff, color: "text-red-600 bg-red-50" },
  late_arrival: { label: "Late", icon: Clock, color: "text-amber-600 bg-amber-50" },
  no_clock_out: { label: "No clock-out", icon: Timer, color: "text-red-600 bg-red-50" },
  overtime_detected: { label: "OT detected", icon: Clock, color: "text-blue-600 bg-blue-50" },
  no_gps_data: { label: "No GPS", icon: MapPinOff, color: "text-gray-600 bg-gray-50" },
};

export default function AttendanceReviewPage() {
  const [filter, setFilter] = useState<"flagged" | "all">("flagged");
  const [outletId, setOutletId] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const { data: scheduleList } = useFetch<{ outlets: { id: string; name: string }[] }>("/api/hr/schedules");
  const outlets = scheduleList?.outlets ?? [];
  const qs = new URLSearchParams({ status: filter });
  if (outletId) qs.set("outlet_id", outletId);
  if (date) qs.set("date", date);
  const { data, mutate } = useFetch<{ logs: EnrichedLog[]; count: number }>(`/api/hr/attendance?${qs.toString()}`);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // "Fix times" inline editor: which log is being edited + its MYT-input values.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCI, setEditCI] = useState("");
  const [editCO, setEditCO] = useState("");
  const { prompt, PromptDialog } = usePrompt();

  // datetime-local <-> UTC ISO, treating the input as Malaysia wall time (UTC+8).
  const toMytInput = (iso: string | null): string =>
    !iso ? "" : new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 16);
  const fromMytInput = (v: string): string | null => {
    if (!v) return null;
    const ms = Date.parse(`${v}:00+08:00`);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  };

  const openEditor = (log: EnrichedLog) => {
    setEditingId(log.id);
    setEditCI(toMytInput(log.clock_in));
    setEditCO(toMytInput(log.clock_out));
  };

  const handleSetTimes = async (id: string) => {
    const clockInIso = fromMytInput(editCI);
    const clockOutIso = fromMytInput(editCO);
    if (!clockOutIso) return; // a clock-out time is required
    setReviewingId(id);
    try {
      const res = await fetch("/api/hr/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "set_times", clockIn: clockInIso, clockOut: clockOutIso }),
      });
      if (res.ok) {
        setEditingId(null);
        mutate();
      }
    } finally {
      setReviewingId(null);
    }
  };

  const handleReview = async (id: string, action: "acknowledge" | "excuse" | "reject", excuseReason?: string) => {
    setReviewingId(id);
    try {
      await fetch("/api/hr/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, excuseReason }),
      });
      mutate();
    } finally {
      setReviewingId(null);
    }
  };

  const handleExcuse = async (id: string) => {
    const reason = await prompt({
      title: "Reason for excusing",
      placeholder: "e.g. medical, traffic accident, pre-agreed",
      multiline: true,
      required: true,
    });
    if (reason === null) return;
    await handleReview(id, "excuse", reason || undefined);
  };

  const logs = data?.logs || [];

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <PromptDialog />
      <HrPageHeader
        title="Attendance Review"
        description={
          filter === "flagged"
            ? `${logs.length} flagged item${logs.length !== 1 ? "s" : ""} need review`
            : `${logs.length} attendance log${logs.length !== 1 ? "s" : ""}`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground"
              title="Filter by outlet"
            >
              <option value="">All outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border bg-card px-2.5 py-1.5 text-sm text-foreground"
              title="Filter by date"
            />
            {(outletId || date) && (
              <button
                onClick={() => { setOutletId(""); setDate(""); }}
                className="rounded-lg border px-2.5 py-1.5 text-sm text-gray-600 hover:bg-muted"
              >
                Clear
              </button>
            )}
            <div className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
              <button
                onClick={() => setFilter("flagged")}
                className={`rounded-md px-3 py-1.5 font-medium ${filter === "flagged" ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
              >
                Flagged
              </button>
              <button
                onClick={() => setFilter("all")}
                className={`rounded-md px-3 py-1.5 font-medium ${filter === "all" ? "bg-terracotta text-white" : "text-gray-600 hover:bg-muted"}`}
              >
                All
              </button>
            </div>
          </div>
        }
      />

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-green-500" />
          <p className="text-lg font-semibold">All clear</p>
          <p className="text-sm text-muted-foreground">
            {filter === "flagged" ? "No flagged attendance items" : "No attendance logs"}
            {(outletId || date) ? " for this filter" : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {/* Clock-in & clock-out selfies */}
                  <div className="flex flex-shrink-0 gap-1">
                    {log.clock_in_photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={log.clock_in_photo_url}
                        alt="Clock-in"
                        className="h-14 w-14 flex-shrink-0 cursor-zoom-in rounded-lg object-cover"
                        onClick={() => setPreviewUrl(log.clock_in_photo_url)}
                      />
                    ) : (
                      <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <ImageOff className="h-5 w-5" />
                      </div>
                    )}
                    {log.clock_out_photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={log.clock_out_photo_url}
                        alt="Clock-out"
                        className="h-14 w-14 flex-shrink-0 cursor-zoom-in rounded-lg object-cover opacity-90"
                        onClick={() => setPreviewUrl(log.clock_out_photo_url)}
                        title="Clock-out selfie"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">
                      {log.user_name || log.user_id.slice(0, 8) + "..."}
                    </p>
                    {log.user_nickname && log.user_name && log.user_nickname !== log.user_name && (
                      <p className="text-xs text-muted-foreground">({log.user_nickname})</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {log.outlet_name && <span>{log.outlet_name} &middot; </span>}
                      {new Date(log.clock_in).toLocaleDateString("en-MY")} &middot;{" "}
                      {timeMyt(log.clock_in)}
                      {log.clock_out && <> &rarr; {timeMyt(log.clock_out)}</>}
                      {log.total_hours != null && <span> &middot; {log.total_hours}h{(log.overtime_hours ?? 0) > 0 ? ` (${log.overtime_hours}h OT)` : ""}</span>}
                    </p>
                    {/* Scheduled vs actual — how late / early vs the roster */}
                    {log.scheduled_start && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Rostered {timeMyt(log.scheduled_start)}{log.scheduled_end ? `–${timeMyt(log.scheduled_end)}` : ""} · </span>
                        {log.late_minutes > 2 ? (
                          <span className="font-medium text-amber-600">{fmtMins(log.late_minutes)} late</span>
                        ) : log.late_minutes < -2 ? (
                          <span className="text-green-700">{fmtMins(log.late_minutes)} early</span>
                        ) : (
                          <span className="text-green-700">on time</span>
                        )}
                      </p>
                    )}
                    {/* Geo + clock method context */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <GeoChip label="In" lat={log.clock_in_lat} lng={log.clock_in_lng} distance={log.clock_in_distance_m} radius={log.geofence_radius_m} />
                      {log.clock_out && (
                        <GeoChip label="Out" lat={log.clock_out_lat} lng={log.clock_out_lng} distance={log.clock_out_distance_m} radius={log.geofence_radius_m} />
                      )}
                      {[log.clock_in_method, log.clock_out_method].filter((m, i, a) => m && a.indexOf(m) === i).map((m) => {
                        const info = CLOCK_METHOD[m as string];
                        if (!info) return null;
                        const Icon = info.icon;
                        return (
                          <span key={m} className={`inline-flex items-center gap-1 text-[11px] ${info.color}`}>
                            <Icon className="h-3 w-3" /> {info.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap justify-end gap-2">
                  {log.ai_flags.map((flag) => {
                    const info = FLAG_LABELS[flag] || { label: flag, color: "text-gray-600 bg-gray-50" };
                    return (
                      <span key={flag} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${info.color}`}>
                        {info.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => handleReview(log.id, "acknowledge")}
                  disabled={reviewingId === log.id}
                  title="Penalty applies as calculated"
                  className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {reviewingId === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Acknowledge
                </button>
                <button
                  onClick={() => handleExcuse(log.id)}
                  disabled={reviewingId === log.id}
                  title="Waive penalty — legitimate reason"
                  className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Excuse
                </button>
                <button
                  onClick={() => handleReview(log.id, "reject")}
                  disabled={reviewingId === log.id}
                  title="Discard log (bogus entry)"
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => (editingId === log.id ? setEditingId(null) : openEditor(log))}
                  disabled={reviewingId === log.id}
                  title={log.clock_out ? "Correct the clock in / out times" : "Manually clock this staffer out"}
                  className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-muted disabled:opacity-50"
                >
                  <PencilLine className="h-3 w-3" />
                  {log.clock_out ? "Fix times" : "Clock out"}
                </button>
              </div>

              {/* Fix-times editor: manual clock-out for an open log, or a time
                  correction. Hours recompute server-side via the shared engine. */}
              {editingId === log.id && (
                <div className="mt-3 space-y-2 rounded-lg border bg-muted/40 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="flex-1 text-xs font-medium text-muted-foreground">
                      Clock in (MYT)
                      <input
                        type="datetime-local"
                        value={editCI}
                        onChange={(e) => setEditCI(e.target.value)}
                        className="mt-1 w-full rounded-md border bg-card px-2 py-1 text-sm text-foreground"
                      />
                    </label>
                    <label className="flex-1 text-xs font-medium text-muted-foreground">
                      Clock out (MYT)
                      <input
                        type="datetime-local"
                        value={editCO}
                        onChange={(e) => setEditCO(e.target.value)}
                        className="mt-1 w-full rounded-md border bg-card px-2 py-1 text-sm text-foreground"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSetTimes(log.id)}
                      disabled={reviewingId === log.id || !editCO}
                      className="flex items-center gap-1 rounded-lg bg-terracotta px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-dark disabled:opacity-50"
                    >
                      {reviewingId === log.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Save times
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={reviewingId === log.id}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <span className="text-[11px] text-muted-foreground">Hours recompute automatically. Times are Malaysia time.</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Clock-in preview" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
