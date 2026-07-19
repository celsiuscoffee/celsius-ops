import { getAgentClient } from "./substrate";
import { agentLabel } from "./messages";
import { sendPulse } from "./pulse";

// Daily digest for the pulse channel: a plain-English roundup of what the
// agents told each other, learned, corrected, and changed in the last 24h.
// Complements the real-time pushes with one once-a-day summary, then stamps
// digested_at so the same messages aren't re-summarized tomorrow.
//
// No dedicated Vercel cron (the project is near the 40-cron cap): this is
// folded into the owner-briefing cron's 9pm MYT firing. runCommsDigest is also
// exposed via /api/cron/agent-comms-digest for manual/on-demand runs.

const KIND_ORDER: { kind: string; heading: string }[] = [
  { kind: "handoff", heading: "🔁 Handoffs (who passed work to whom)" },
  { kind: "correction", heading: "🛠 Corrections (a verifier taught an agent)" },
  { kind: "learning", heading: "🧠 Learnings" },
  { kind: "logic_change", heading: "⚙️ Logic changes" },
  { kind: "report", heading: "📣 Reports to the owner" },
];

export async function runCommsDigest(): Promise<{ sent: boolean; messages: number }> {
  const client = getAgentClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await client
    .from("agent_messages")
    .select("id, from_agent, to_agent, kind, summary")
    .gte("at", since)
    .order("at", { ascending: true });
  if (error) {
    console.error("[comms-digest] read failed:", error);
    return { sent: false, messages: 0 };
  }

  const rows = data ?? [];
  if (rows.length === 0) return { sent: false, messages: 0 };

  const dateStr = new Date().toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
  });
  const lines: string[] = [
    `🤖 <b>Agent activity, ${dateStr}</b>`,
    `<i>${rows.length} message${rows.length === 1 ? "" : "s"} in the last 24 hours</i>`,
  ];

  for (const { kind, heading } of KIND_ORDER) {
    const of = rows.filter((r) => r.kind === kind);
    if (of.length === 0) continue;
    lines.push("", `<b>${heading}</b>`);
    for (const r of of) {
      const to = r.to_agent ? ` → ${escapeHtml(agentLabel(r.to_agent))}` : "";
      lines.push(`• <b>${escapeHtml(agentLabel(r.from_agent))}</b>${to}: ${escapeHtml(r.summary)}`);
    }
  }

  const sent = await sendPulse(lines.join("\n"));

  // Mark this window's messages digested so they don't recur tomorrow.
  const ids = rows.map((r) => r.id);
  await client.from("agent_messages").update({ digested_at: new Date().toISOString() }).in("id", ids);

  return { sent, messages: rows.length };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
