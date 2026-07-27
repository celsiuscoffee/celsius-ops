// Proactive morning briefing - the "two-way, not just reactive" half of the
// intelligence agent. Once a day the agent messages the owner FIRST: yesterday's
// numbers, what moved, anomalies worth attention, and how the month is pacing
// vs the target it has learned. Reuses the same intelligence loop (so it uses
// learned facts + the warehouse), then pushes the result to Telegram.
//
// Folded into the celsius-overview cron's 9am-MYT firing (no new Vercel cron).

import { getAgentModeOrDefault } from "@celsius/agents/src/substrate";
import { sendPulse } from "@celsius/agents/src/pulse";
import { logAgentMessage } from "@celsius/agents/src/messages";
import { runIntelligence } from "./intelligence";

const BRIEFING_PROMPT = `Produce this morning's briefing for the owner of Celsius Coffee. Use the warehouse (unified_sales) to compare YESTERDAY's all-channel sales - total, by channel (pos_native, pickup, grab, consignment), and by outlet - against the trailing 28-day daily average, and call out anything notably up or down (roughly a 20%+ move). If you know the monthly revenue target, note how the month is pacing against it (MTD vs the run-rate projection). Keep it tight and skimmable on a phone: one headline line, 2-4 bullets of what actually matters (movements + anomalies), and one thing to watch today. Lead with the number. RM, MYT. If yesterday genuinely had no meaningful sales data, reply with exactly: SKIP.`;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function runIntelligenceBriefing(): Promise<{ sent: boolean; skipped?: string }> {
  // Respect the kill switch (default armed so a lagging seed can't silence it).
  if ((await getAgentModeOrDefault("data_analyst", "armed")) === "off") {
    return { sent: false, skipped: "agent off" };
  }
  // Isolated chat context so the briefing thread never mixes with the owner's
  // Q&A history; learned memory (analyst_memory) is global so the target still
  // applies.
  const res = await runIntelligence("daily-briefing", BRIEFING_PROMPT, "system", { skipHistory: true });
  if (res.error) return { sent: false, skipped: res.error };
  const answer = (res.answer ?? "").trim();
  if (!answer || /^skip$/i.test(answer)) return { sent: false, skipped: "nothing notable" };

  const msgId = await sendPulse(`☀️ <b>Morning briefing</b>\n\n${escapeHtml(answer)}`);
  // Also drop it on the /agents feed so it's on the record (no extra ping).
  await logAgentMessage({
    fromAgent: "data_analyst",
    toAgent: "owner",
    kind: "report",
    summary: answer.slice(0, 300),
    notify: false,
  });
  return { sent: msgId !== null };
}
