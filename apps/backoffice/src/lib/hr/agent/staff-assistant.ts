// HR staff assistant — the STAFF persona of the HR Ops Agent (WhatsApp).
// Design: docs/design/hr-ops-agent.md §1 (staff persona), §5 (voice).
//
// A message from an ACTIVE STAFF-role phone lands here from the webhook, after
// the internal (owner/admin/manager) intake and BEFORE the supplier flows.
// That ordering is load-bearing: staff numbers previously fell through toward
// the supplier pipeline, where an MC photo could be vision-read as a supplier
// invoice. A matched staff sender is therefore ALWAYS consumed
// ({ handled: true }) — even when the agent is off — so supplier flows never
// touch staff messages again.
//
// v1 scope (stage 1, read-only):
//   - Own-record reads: shifts, clocked hours, leave balance/requests, claims.
//   - Policy answers (leave/sick entitlements, OT multipliers, payday) from
//     the employment-letter terms baked into the prompt.
//   - Grievances / bank changes / anything sensitive → escalate_to_human
//     (owner digest), never self-served. Bank account numbers are NEVER taken
//     over chat from a staff message (payroll-diversion guard, design §3).
//   - NO pay-figure reads yet (PIN-gated payslip reads are v1.1) and NO writes.
//
// Kill switch: agent_registry key "hr_ops_agent" via getAgentMode (fail-safe
// off — silent consume until the registry row is armed to shadow/armed).

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { sendOpsDigest } from "@/lib/ops-pulse/sender";
import { resolveOwner } from "@/lib/ops-pulse/router";
import { samePhone } from "@/lib/ops-pulse/inbound";
import { getAgentMode, logAgentAction, type AgentMode } from "@celsius/agents/src/substrate";
import { staffSubmitLeave, staffUpdateOwnContact } from "./write-ops";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const HR_AGENT_KEY = "hr_ops_agent";
const MODEL = "claude-sonnet-4-6"; // repo precedent: supplier-chat + internal assistant
const MAX_ROUNDS = 3;

const digits = (s: string) => s.replace(/[^0-9]/g, "");
const MYT_OFFSET_MS = 8 * 3_600_000;
const mytNow = () => new Date(Date.now() + MYT_OFFSET_MS);
const mytYmd = () => mytNow().toISOString().slice(0, 10);

// Monday 00:00 MYT of the current week, as a YYYY-MM-DD string (PT pay weeks
// run Mon–Sun per the payroll spec).
export function mytWeekStartYmd(now: Date = mytNow()): string {
  const dow = now.getUTCDay(); // shifted clock — UTC fields ARE MYT fields
  const back = (dow + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(now.getTime() - back * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

export interface StaffInboundInput {
  fromNumber: string;
  text: string | null;
  waMessageId: string;
  type: string; // text | image | document | ...
  mediaUrl: string | null;
}

export interface StaffInboundResult {
  handled: boolean; // true = staff sender; webhook must skip supplier flows
  replied?: boolean;
}

const NOT_STAFF: StaffInboundResult = { handled: false };

interface StaffSender {
  id: string;
  name: string;
  outletId: string | null;
  outletName: string | null;
  position: string | null;
  employmentType: string | null;
}

// ── Self-scoped tools ─────────────────────────────────────────────────────────
// Every query is pinned to the resolved sender's user id server-side; the
// model cannot ask about anyone else (design §3: own-record only).

async function myShifts(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ shift_date: string; start_time: string | null; end_time: string | null; outlet: string }>
  >`
    SELECT s.shift_date::text, s.start_time::text, s.end_time::text, o.name AS outlet
    FROM hr_schedule_shifts s
    JOIN hr_schedules sch ON sch.id = s.schedule_id AND sch.published_at IS NOT NULL
    JOIN "Outlet" o ON o.id = sch.outlet_id
    WHERE s.user_id = ${userId}
      AND s.shift_date >= (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
      AND s.shift_date < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + 8
    ORDER BY s.shift_date, s.start_time
  `;
  return {
    today: mytYmd(),
    shifts: rows.map((r) => ({ date: r.shift_date, start: r.start_time, end: r.end_time, outlet: r.outlet })),
    note: rows.length === 0 ? "no published shifts in the next 7 days" : undefined,
  };
}

async function myHours(userId: string) {
  const weekStart = mytWeekStartYmd();
  const rows = await prisma.$queryRaw<
    Array<{ day: string; hours: number | null; ot: number | null }>
  >`
    SELECT ((clock_in AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::text AS day,
           sum(total_hours)::float AS hours, sum(overtime_hours)::float AS ot
    FROM hr_attendance_logs
    WHERE user_id = ${userId}
      AND clock_in >= ${new Date(`${weekStart}T00:00:00+08:00`)}
    GROUP BY 1 ORDER BY 1
  `;
  const total = rows.reduce((s, r) => s + (r.hours ?? 0), 0);
  return {
    weekStart,
    perDay: rows.map((r) => ({ day: r.day, hours: r.hours ?? 0, overtime: r.ot ?? 0 })),
    totalHours: Math.round(total * 100) / 100,
    note: "hours from clock-in/out records this week (Mon–Sun, MYT)",
  };
}

async function myLeave(userId: string) {
  const year = mytNow().getUTCFullYear();
  const [balances, requests] = await Promise.all([
    prisma.$queryRaw<Array<{ leave_type: string; entitled: number; used: number; pending: number }>>`
      SELECT leave_type, entitled_days::float AS entitled, used_days::float AS used, pending_days::float AS pending
      FROM hr_leave_balances WHERE user_id = ${userId} AND year = ${year}
    `,
    prisma.$queryRaw<
      Array<{ leave_type: string; start_date: string; end_date: string; days: number; status: string }>
    >`
      SELECT leave_type, start_date::text, end_date::text, total_days::float AS days, status
      FROM hr_leave_requests WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 3
    `,
  ]);
  return {
    year,
    balances: balances.map((b) => ({
      type: b.leave_type,
      entitled: b.entitled,
      used: b.used,
      pending: b.pending,
      remaining: b.entitled - b.used - b.pending,
    })),
    recentRequests: requests,
    note: "to APPLY for leave, use the staff app — approval stays with the manager",
  };
}

async function myClaims(userId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ purchase_date: string; category: string; amount: number; status: string; paid_at: string | null }>
  >`
    SELECT purchase_date::text, category, amount::float, status, paid_at::text
    FROM hr_claims WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 5
  `;
  return { claims: rows };
}

// ── Voice & policy ────────────────────────────────────────────────────────────
// Policy facts come from the standard Letter of Employment terms (see the LOE
// template + docs/hr-payroll-spec.md). Figures here are POLICY, not personal
// pay data — personal pay figures are deliberately not readable in v1.

const STAFF_SYSTEM = `You are Cel, Celsius Coffee's digital HR assistant, chatting with a STAFF MEMBER on WhatsApp.

Voice:
- Mirror the sender's language — Malay, English, or their Manglish mix. Short, warm, chat-style: 1-4 lines, no headers, no tables, *bold* for the key fact. One question at a time.
- You are friendly and human in tone, but NEVER claim to be human. If asked whether you're a bot/robot/AI, say honestly and lightly that you're the company's digital HR assistant.
- If this is the first conversation (no history), open with one short line introducing yourself as the Celsius digital HR assistant.

What you can do (tools, all about THIS person only):
- my_shifts (their published roster, next 7 days), my_hours (clocked hours this week), my_leave (balances + recent requests), my_claims (recent claim statuses).
- Answer policy questions from these standard employment terms: pay is in the bank on or before the 7th of the month; part-timer wages are paid weekly (Mon–Sun week). Annual leave: 8 days (<2 yrs service), 12 (2–5 yrs), 16 (>5 yrs) — apply in the staff app, manager approves. Sick leave: 14 days (<2 yrs), 18 (2–5), 22 (>5), MC required; hospitalization up to 60 days combined. OT (approved only): 1.5× weekday, 2× rest day, 3× public holiday. Probation: 1 month, confirmation in writing; notice: 2 weeks during probation, 1 month after confirmation.

Hard rules:
- ONLY this person's own data. If they ask about someone else's schedule/pay, politely decline (their manager can help).
- NO personal pay figures in chat yet (payslip amounts, salary) — direct them to the staff app payslips or their manager. Policy figures above are fine.
- NEVER take or change bank account details over chat, even if they insist — say bank changes must be confirmed with the manager/HQ, then call escalate_to_human so HQ follows up.
- Complaints, grievances, resignation notices, anything about another person's conduct, or anything you cannot handle → acknowledge with empathy, say you're passing it to HQ, and call escalate_to_human. Do not attempt to counsel or resolve it yourself.
- Never invent data. If a tool returns nothing, say so plainly.`;

// Appended only when the registry mode is "armed" — the write tools don't
// exist in the toolset at all outside armed mode.
const STAFF_ARMED_ADDENDUM = `

Actions you CAN take directly (armed):
- submit_leave_request — BEFORE calling, restate the dates back in full words ("3 hingga 4 Ogos 2026, 2 hari, annual leave — betul?") and wait for their yes. The request still goes to their manager for approval; say so. Balance shortfalls are flagged, not blocked.
- update_my_contact — emergency contact name/phone, personal email, home address. Update immediately when given.
- Swaps and availability: still the staff app / roster messages.
- Bank details remain OFF-LIMITS in chat no matter what — escalate_to_human.`;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function handleStaffInbound(input: StaffInboundInput): Promise<StaffInboundResult> {
  // Resolve the sender in its own guard: a lookup failure must fall through as
  // NOT staff (so real suppliers still reach the supplier agent), mirroring
  // ops-intake's reporter lookup.
  let sender: StaffSender | undefined;
  try {
    const users = await prisma.user.findMany({
      where: { role: "STAFF", status: "ACTIVE", phone: { not: null } },
      select: { id: true, name: true, phone: true, outletId: true, outlet: { select: { name: true } } },
    });
    const hit = users.find((u) => u.phone && samePhone(input.fromNumber, u.phone));
    if (hit) {
      const profile = await prisma.$queryRaw<Array<{ position: string | null; employment_type: string | null }>>`
        SELECT position, employment_type FROM hr_employee_profiles WHERE user_id = ${hit.id}
      `;
      sender = {
        id: hit.id,
        name: hit.name,
        outletId: hit.outletId,
        outletName: hit.outlet?.name ?? null,
        position: profile[0]?.position ?? null,
        employmentType: profile[0]?.employment_type ?? null,
      };
    }
  } catch (err) {
    console.error("[hr-agent:staff] sender lookup failed:", err instanceof Error ? err.message : err);
    return NOT_STAFF;
  }
  if (!sender) return NOT_STAFF;

  // From here on the sender IS staff: always consume, never throw — the
  // supplier pipeline must not see this message regardless of what happens.
  try {
    const mode = await getAgentMode(HR_AGENT_KEY);
    if (mode === "off") {
      console.log(`[hr-agent:staff] consumed (mode=off) from=${sender.name}`);
      return { handled: true, replied: false };
    }

    // Media (MC photos, receipts): no document intake in v1 — acknowledge and
    // redirect so the photo isn't silently swallowed.
    if (input.type !== "text") {
      const text = `Hi ${sender.name.split(/\s+/)[0]}! Saya belum boleh terima gambar/dokumen lagi 🙏 Untuk MC atau resit claim, hantar dalam staff app atau terus kepada manager ya.`;
      await replyAndRecord(input.fromNumber, text);
      await logAgentAction({
        agentKey: HR_AGENT_KEY,
        kind: "staff_media_redirect",
        summary: `media from ${sender.name} redirected to staff app/manager`,
        outletId: sender.outletId ?? undefined,
      });
      return { handled: true, replied: true };
    }

    const body = (input.text ?? "").trim();
    if (!body) return { handled: true, replied: false };

    // Recent two-way history for continuity (same store the inbox uses).
    const history = await prisma.whatsAppMessage.findMany({
      where: { OR: [{ fromNumber: digits(input.fromNumber) }, { toNumber: digits(input.fromNumber) }] },
      orderBy: { timestamp: "desc" },
      take: 10,
      select: { direction: true, body: true },
    });

    const outcome = await runStaffAssistant(sender, body, history.reverse(), mode);
    if (outcome.escalated) {
      const owner = await resolveOwner();
      if (owner?.phone) {
        await sendOpsDigest(owner.phone, "🙋 Staff message for HQ", [
          `${sender.name} (${sender.outletName ?? "no outlet"}): ${body.slice(0, 300)}`,
        ]);
      }
      // Ledger row carries the topic only — grievance CONTENT stays out of the
      // general action ledger by design (§5): the owner digest is the record.
      await logAgentAction({
        agentKey: HR_AGENT_KEY,
        kind: "staff_escalation",
        summary: `escalated to HQ: ${outcome.topic ?? "sensitive/unhandled"} (from ${sender.name})`,
        outletId: sender.outletId ?? undefined,
      });
    }
    if (outcome.reply) {
      await replyAndRecord(input.fromNumber, outcome.reply);
      await logAgentAction({
        agentKey: HR_AGENT_KEY,
        kind: "staff_reply",
        summary: `answered ${sender.name}: ${body.slice(0, 120)}`,
        outletId: sender.outletId ?? undefined,
        model: MODEL,
      });
      return { handled: true, replied: true };
    }
    return { handled: true, replied: outcome.escalated };
  } catch (err) {
    console.error("[hr-agent:staff] failed:", err instanceof Error ? err.message : err);
    return { handled: true, replied: false };
  }
}

async function replyAndRecord(to: string, text: string): Promise<void> {
  const sent = await sendWhatsAppText(to, text);
  await recordOutboundMessage({
    waMessageId: sent.messageId,
    fromNumber: "",
    toNumber: to,
    type: "text",
    body: text,
    status: sent.ok ? "sent" : "failed",
    raw: { agent: HR_AGENT_KEY, ok: sent.ok, error: sent.error ?? null },
  });
}

async function runStaffAssistant(
  sender: StaffSender,
  text: string,
  history: Array<{ direction: string; body: string | null }>,
  mode: AgentMode,
): Promise<{ reply: string | null; escalated: boolean; topic?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { reply: null, escalated: false };
  const armed = mode === "armed";

  const tools: Anthropic.Tool[] = [
    { name: "my_shifts", description: "This staff member's published shifts for the next 7 days.", input_schema: { type: "object" as const, properties: {} } },
    { name: "my_hours", description: "Hours this staff member has clocked this week (Mon–Sun MYT), per day and total.", input_schema: { type: "object" as const, properties: {} } },
    { name: "my_leave", description: "This staff member's leave balances for the year and their 3 most recent leave requests.", input_schema: { type: "object" as const, properties: {} } },
    { name: "my_claims", description: "This staff member's 5 most recent expense claims with statuses.", input_schema: { type: "object" as const, properties: {} } },
    {
      name: "escalate_to_human",
      description:
        "Route this conversation to HQ (the owner). Call for: grievances/complaints, resignation notices, bank-account changes, requests about other people, or anything outside your tools. The routing happens outside — just call it, then tell the person it's been passed on.",
      input_schema: {
        type: "object" as const,
        properties: { topic: { type: "string", description: "2-5 word topic label, e.g. 'bank change request'" } },
      },
    },
    // Write tools exist ONLY in armed mode — outside it the model can't even
    // see them (guardrail in code, not prompt).
    ...(armed
      ? ([
          {
            name: "submit_leave_request",
            description:
              "Submit this staff member's leave request (goes to their manager as pending — never auto-approved). Call ONLY after restating the dates in words and getting their yes. Dates must be ISO YYYY-MM-DD.",
            input_schema: {
              type: "object" as const,
              properties: {
                leave_type: { type: "string", enum: ["annual", "sick", "emergency", "unpaid"] },
                start_date: { type: "string", description: "YYYY-MM-DD" },
                end_date: { type: "string", description: "YYYY-MM-DD" },
                reason: { type: "string" },
              },
              required: ["leave_type", "start_date", "end_date"],
            },
          },
          {
            name: "update_my_contact",
            description:
              "Update this staff member's own contact/profile info: emergency contact, personal email, home address. NEVER bank details (those escalate to HQ).",
            input_schema: {
              type: "object" as const,
              properties: {
                emergency_name: { type: "string" },
                emergency_phone: { type: "string" },
                personal_email: { type: "string" },
                address_line1: { type: "string" },
                address_city: { type: "string" },
                address_state: { type: "string" },
                address_postcode: { type: "string" },
              },
            },
          },
        ] as Anthropic.Tool[])
      : []),
  ];
  const run: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    my_shifts: () => myShifts(sender.id),
    my_hours: () => myHours(sender.id),
    my_leave: () => myLeave(sender.id),
    my_claims: () => myClaims(sender.id),
    ...(armed
      ? {
          submit_leave_request: async (input) => {
            const summary = await staffSubmitLeave(sender.id, {
              leaveType: String(input.leave_type ?? "annual"),
              startDate: String(input.start_date ?? ""),
              endDate: String(input.end_date ?? ""),
              reason: input.reason ? String(input.reason) : undefined,
            });
            await logAgentAction({
              agentKey: HR_AGENT_KEY,
              kind: "staff_write",
              summary: `leave request by ${sender.name}: ${summary}`.slice(0, 400),
              outletId: sender.outletId ?? undefined,
              meta: { requestedById: sender.id, tool: "submit_leave_request" },
            });
            return { ok: true, summary };
          },
          update_my_contact: async (input) => {
            const summary = await staffUpdateOwnContact(sender.id, {
              emergencyName: input.emergency_name ? String(input.emergency_name) : undefined,
              emergencyPhone: input.emergency_phone ? String(input.emergency_phone) : undefined,
              personalEmail: input.personal_email ? String(input.personal_email) : undefined,
              addressLine1: input.address_line1 ? String(input.address_line1) : undefined,
              addressCity: input.address_city ? String(input.address_city) : undefined,
              addressState: input.address_state ? String(input.address_state) : undefined,
              addressPostcode: input.address_postcode ? String(input.address_postcode) : undefined,
            });
            await logAgentAction({
              agentKey: HR_AGENT_KEY,
              kind: "staff_write",
              summary: `contact update by ${sender.name}: ${summary}`.slice(0, 400),
              outletId: sender.outletId ?? undefined,
              meta: { requestedById: sender.id, tool: "update_my_contact" },
            });
            return { ok: true, summary };
          },
        }
      : {}),
  };

  const historyLines = history
    .filter((h) => (h.body ?? "").trim())
    .slice(-8)
    .map((h) => `${h.direction === "inbound" ? sender.name : "Cel"}: ${(h.body ?? "").slice(0, 250)}`)
    .join("\n");
  const intro = `Sender: ${sender.name} — ${sender.position ?? "staff"} (${sender.employmentType ?? "?"}) at ${sender.outletName ?? "no outlet on file"}. Today (MYT): ${mytYmd()}.${historyLines ? `\n\nRecent conversation:\n${historyLines}` : "\n\n(First conversation — introduce yourself briefly.)"}\n\nNew message:\n${text}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: intro }];
  let escalated = false;
  let topic: string | undefined;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: STAFF_SYSTEM + (armed ? STAFF_ARMED_ADDENDUM : ""),
      tools,
      messages,
    });
    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return { reply: reply || null, escalated, topic };
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let payload: unknown;
      if (tu.name === "escalate_to_human") {
        escalated = true;
        topic = String((tu.input as { topic?: string })?.topic ?? "").slice(0, 60) || undefined;
        payload = { routed: true, note: "HQ has been notified — reassure the sender." };
      } else {
        try {
          payload = run[tu.name]
            ? await run[tu.name]((tu.input ?? {}) as Record<string, unknown>)
            : { error: "unknown tool" };
        } catch (err) {
          payload = { error: err instanceof Error ? err.message : "tool failed" };
        }
      }
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
      });
    }
    messages.push({ role: "user", content: results });
  }
  console.warn("[hr-agent:staff] ran out of rounds without a final reply");
  return { reply: null, escalated, topic };
}
