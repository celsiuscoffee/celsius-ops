"use client";

import { useState } from "react";
import { MessageSquare, BellRing, Megaphone } from "lucide-react";
import { useFetch } from "@/lib/use-fetch";
import InboxPanel from "./_InboxPanel";
import RemindersPanel from "./_RemindersPanel";
import InstructionsPanel from "./_InstructionsPanel";

type Summary = {
  inbox: { threads: number; awaitingReply: number };
  reminders: { open: number };
  instructions: { pending: number };
};

type Segment = "inbox" | "reminders" | "instructions";

export default function OpsWorkspacePage() {
  const [seg, setSeg] = useState<Segment>("inbox");
  // One light poll drives all segment counters; panels fetch their own data.
  const { data: summary, mutate } = useFetch<Summary>("/api/ops/workspace/summary");

  const tabs: { key: Segment; label: string; Icon: typeof MessageSquare; count: number }[] = [
    { key: "inbox", label: "Inbox", Icon: MessageSquare, count: summary?.inbox.awaitingReply ?? 0 },
    { key: "reminders", label: "Reminders", Icon: BellRing, count: summary?.reminders.open ?? 0 },
    { key: "instructions", label: "Instructions", Icon: Megaphone, count: summary?.instructions.pending ?? 0 },
  ];

  return (
    <div className="px-4 pt-6 pb-10 md:px-8">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold leading-[30px] tracking-[-0.01em] text-text">What happened</h1>
        <p className="mt-0.5 text-sm text-text-2">
          Conversations with staff on WhatsApp, instructions sent to them, and follow-ups still open.
        </p>
      </div>

      {/* Segmented control */}
      <div className="mb-4 flex gap-x-6 overflow-x-auto border-b border-line">
        {tabs.map(({ key, label, Icon, count }) => {
          const active = seg === key;
          return (
            <button
              key={key}
              onClick={() => setSeg(key)}
              className={
                "-mb-px flex min-h-10 shrink-0 items-center gap-1.5 border-b-2 text-sm transition " +
                (active
                  ? "border-text font-semibold text-text"
                  : "border-transparent text-text-2 hover:text-text")
              }
            >
              <Icon className="h-4 w-4" />
              {label}
              {count > 0 && (
                <span className="rounded-full bg-warn-soft px-1.5 text-[11px] leading-5 text-warn-text">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {seg === "inbox" && <InboxPanel />}
      {seg === "reminders" && <RemindersPanel onChange={mutate} />}
      {seg === "instructions" && <InstructionsPanel onChange={mutate} />}
    </div>
  );
}
