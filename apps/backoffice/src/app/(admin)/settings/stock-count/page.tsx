"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CalendarDays, Loader2, Check } from "lucide-react";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

const MONTH_DAYS = [28, 29, 30, 31];

export default function StockCountSettingsPage() {
  const [weeklyDays, setWeeklyDays] = useState<number[]>([0, 2, 4]);
  const [endOfMonthDays, setEndOfMonthDays] = useState<number[]>([28, 29, 30, 31]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/stock-count")
      .then((r) => r.json())
      .then((data) => {
        if (data.weeklyDays) setWeeklyDays(data.weeklyDays);
        if (data.endOfMonthDays) setEndOfMonthDays(data.endOfMonthDays);
      })
      .finally(() => setLoading(false));
  }, []);

  const toggleDay = (day: number) => {
    setWeeklyDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
    setSaved(false);
  };

  const toggleMonthDay = (day: number) => {
    setEndOfMonthDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/stock-count", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyDays, endOfMonthDays }),
      });
      if (res.ok) setSaved(true);
      else alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-6 max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Stock Count Schedule</h2>
        <p className="mt-1 text-sm text-gray-500">
          Set which days staff should do stock counts
        </p>
      </div>

      {/* Weekly Days */}
      <Card className="mb-4 p-5">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-terracotta" />
            Weekly Count Days
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">Regular stock count on these days</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button
              key={d.value}
              onClick={() => toggleDay(d.value)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                weeklyDays.includes(d.value)
                  ? "border-terracotta bg-terracotta text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Card>

      {/* End of Month Days */}
      <Card className="mb-6 p-5">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-blue-500" />
            End of Month Full Count
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">Full stock count on these dates each month</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {MONTH_DAYS.map((d) => (
            <button
              key={d}
              onClick={() => toggleMonthDay(d)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                endOfMonthDays.includes(d)
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="bg-terracotta hover:bg-terracotta-dark">
        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : saved ? <Check className="mr-1.5 h-4 w-4" /> : null}
        {saved ? "Saved" : "Save Schedule"}
      </Button>
    </div>
  );
}
