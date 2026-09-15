// Owner to-do nudge: the daily Telegram digest of the board, folded into the
// 9am-MYT morning-briefing firing of the celsius-overview cron (no new cron).
//
// One summary message, then per-card prompts with buttons through askOwner so
// a tap lands in the pulse webhook and mutates the card (see
// dispatchPromptAction -> action "owner_todo"). Skips entirely when the board
// has nothing worth a ping. Design: docs/design/owner-todo-kanban.md.

import { getAgentModeOrDefault, logAgentAction, touchAgentRun } from "@celsius/agents/src/substrate";
import { sendPulse } from "@celsius/agents/src/pulse";
import { askOwner } from "@celsius/agents/src/ask-owner";
import { getOwnerUser, listBoard, captureStats, STAGE_LABEL, type CardView } from "./board";

export const NUDGE_AGENT_KEY = "owner_todo_nudge";
const MAX_TRIAGE_PROMPTS = 5;
const MAX_DUE_PROMPTS = 3;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dueLabel(c: CardView): string {
  if (!c.dueAt) return "";
  const d = new Date(c.dueAt);
  const day = d.toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short" });
  return c.overdue ? ` (overdue ${day})` : ` (due ${day})`;
}

function cardLine(c: CardView): string {
  const src = c.sourceChat ? ` · ${escapeHtml(c.sourceChat)}` : "";
  return `• ${escapeHtml(c.title)}${escapeHtml(dueLabel(c))}${src}`;
}

export async function runOwnerTodoDigest(): Promise<{ sent: boolean; skipped?: string; prompts: number }> {
  if ((await getAgentModeOrDefault(NUDGE_AGENT_KEY, "armed")) === "off") {
    return { sent: false, skipped: "agent off", prompts: 0 };
  }
  await touchAgentRun(NUDGE_AGENT_KEY);
  const owner = await getOwnerUser();
  if (!owner) return { sent: false, skipped: "no OWNER user", prompts: 0 };

  const cards = await listBoard(owner.id);
  const triage = cards.filter((c) => c.stage === "triage");
  const open = cards.filter((c) => c.stage !== "done" && c.stage !== "triage");
  const overdue = open.filter((c) => c.overdue);
  const dueToday = open.filter((c) => {
    if (!c.dueAt || c.overdue) return false;
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    return new Date(c.dueAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" }) === today;
  });
  const doing = open.filter((c) => c.stage === "doing");
  const waiting = open.filter((c) => c.stage === "waiting");

  if (!triage.length && !overdue.length && !dueToday.length && !doing.length) {
    return { sent: false, skipped: "nothing to nudge", prompts: 0 };
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const lines: string[] = [`📋 <b>Your board</b> · ${open.length} open`];
  if (overdue.length) lines.push(`\n<b>Overdue (${overdue.length})</b>`, ...overdue.slice(0, 6).map(cardLine));
  if (dueToday.length) lines.push(`\n<b>Due today (${dueToday.length})</b>`, ...dueToday.slice(0, 6).map(cardLine));
  if (doing.length) lines.push(`\n<b>${STAGE_LABEL.doing} (${doing.length})</b>`, ...doing.slice(0, 4).map(cardLine));
  if (waiting.length) lines.push(`\n<b>${STAGE_LABEL.waiting}</b>: ${waiting.length} card${waiting.length === 1 ? "" : "s"}`);
  if (triage.length) {
    const stats = await captureStats(14);
    const prec = stats.precision == null ? "no verdicts yet" : `${Math.round(stats.precision * 100)}% accepted over 14d`;
    lines.push(`\n<b>Triage (${triage.length})</b> · capture ${prec}. Accept or reject below.`);
  }
  lines.push(`\nBoard: backoffice.celsiuscoffee.com/owner/todo`);
  const summaryId = await sendPulse(lines.join("\n"));

  // ── Per-card prompts ─────────────────────────────────────────────────────
  let prompts = 0;
  for (const c of triage.slice(0, MAX_TRIAGE_PROMPTS)) {
    const excerpt = c.sourceExcerpt ? `\n<i>${escapeHtml(c.sourceExcerpt.slice(0, 160))}</i>` : "";
    const id = await askOwner({
      agentKey: NUDGE_AGENT_KEY,
      kind: "confirm",
      prompt: `🆕 ${c.title}${c.sourceChat ? ` · ${c.sourceChat}` : ""}${excerpt}`,
      options: [
        { label: "✅ Accept", value: "accept" },
        { label: "🗑 Reject", value: "reject" },
      ],
      refTable: "OpsReminder",
      refId: c.id,
      expiresInHours: 72,
      payload: { action: "owner_todo", reminderId: c.id },
    });
    if (id) prompts++;
  }
  for (const c of [...overdue, ...dueToday].slice(0, MAX_DUE_PROMPTS)) {
    const id = await askOwner({
      agentKey: NUDGE_AGENT_KEY,
      kind: "confirm",
      prompt: `⏰ ${c.title}${dueLabel(c)}`,
      options: [
        { label: "✅ Done", value: "done" },
        { label: "⏭ Tomorrow", value: "tomorrow" },
      ],
      refTable: "OpsReminder",
      refId: c.id,
      expiresInHours: 24,
      payload: { action: "owner_todo", reminderId: c.id },
    });
    if (id) prompts++;
  }

  await logAgentAction({
    agentKey: NUDGE_AGENT_KEY,
    kind: "todo_nudged",
    summary: `Digest: ${open.length} open, ${overdue.length} overdue, ${triage.length} in triage, ${prompts} prompts`,
    meta: { open: open.length, overdue: overdue.length, triage: triage.length, prompts },
  });
  return { sent: summaryId !== null, prompts };
}
