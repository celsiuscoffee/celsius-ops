"use client";

import { useState } from "react";
import { MessageSquare, ShieldAlert, BellRing, Megaphone, LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useFetch } from "@/lib/use-fetch";
import InboxPanel from "./_InboxPanel";
import PulsePanel from "./_PulsePanel";
import RemindersPanel from "./_RemindersPanel";
import InstructionsPanel from "./_InstructionsPanel";

type Summary = {
  inbox: { threads: number; awaitingReply: number };
  pulse: { open: number };
  reminders: { open: number };
  instructions: { pending: number };
};

type Segment = "inbox" | "pulse" | "reminders" | "instructions";

export default function OpsWorkspacePage() {
  const [seg, setSeg] = useState<Segment>("inbox");
  // One light poll drives all segment counters; panels fetch their own data.
  const { data: summary, mutate } = useFetch<Summary>("/api/ops/workspace/summary");

  const tabs: { key: Segment; label: string; Icon: typeof MessageSquare; count: number }[] = [
    { key: "inbox", label: "Inbox", Icon: MessageSquare, count: summary?.inbox.awaitingReply ?? 0 },
    { key: "pulse", label: "Pulse", Icon: ShieldAlert, count: summary?.pulse.open ?? 0 },
    { key: "reminders", label: "Reminders", Icon: BellRing, count: summary?.reminders.open ?? 0 },
    { key: "instructions", label: "Instructions", Icon: Megaphone, count: summary?.instructions.pending ?? 0 },
  ];

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-terracotta" />
        <h1 className="text-lg font-semibold">Ops Workspace</h1>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Chats, pulse alerts, reminders &amp; instructions — one place to act
        </span>
      </div>

      {/* Segmented control */}
      <div className="mb-4 inline-flex rounded-lg border bg-muted/40 p-1">
        {tabs.map(({ key, label, Icon, count }) => {
          const active = seg === key;
          return (
            <button
              key={key}
              onClick={() => setSeg(key)}
              className={
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition " +
                (active
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4" />
              {label}
              {count > 0 && (
                <Badge className="bg-terracotta px-1.5 text-[10px] text-white">{count}</Badge>
              )}
            </button>
          );
        })}
      </div>

      {seg === "inbox" && <InboxPanel />}
      {seg === "pulse" && <PulsePanel onChange={mutate} />}
      {seg === "reminders" && <RemindersPanel onChange={mutate} />}
      {seg === "instructions" && <InstructionsPanel onChange={mutate} />}
    </div>
  );
}
