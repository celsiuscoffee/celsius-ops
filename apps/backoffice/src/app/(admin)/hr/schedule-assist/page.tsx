"use client";

// Standalone Schedule Assist page — a thin shell around the shared AssistPanel.
// The same panel is embedded in the Schedules grid (per-day ✨ Assist modal),
// which is the primary flow; this page remains for direct/mobile access.

import { useEffect, useState } from "react";
import { useFetch } from "@/lib/use-fetch";
import { HrPageHeader } from "@/components/hr/page-header";
import { AssistPanel } from "@/components/hr/assist-panel";
import { Users } from "lucide-react";

const mytToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

export default function ScheduleAssistPage() {
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

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <HrPageHeader
        title="Schedule Assist"
        description="Pick a shift, and we rank who fits best — reliability, availability, fairness and cost. Also available inside the Schedules grid via each day's ✨ Assist button."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="rounded-lg border bg-card px-3 py-1.5 text-sm">
              <option value="">Select outlet…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border bg-card px-3 py-1.5 text-sm" />
          </div>
        }
      />

      {!outletId ? (
        <div className="flex flex-col items-center justify-center rounded-xl border bg-card py-16 text-center">
          <Users className="mb-3 h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-semibold">Pick an outlet</p>
          <p className="text-sm text-muted-foreground">Select an outlet and date to start assigning shifts.</p>
        </div>
      ) : (
        <AssistPanel outletId={outletId} date={date} />
      )}
    </div>
  );
}
