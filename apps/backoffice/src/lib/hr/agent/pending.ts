// HR Ops Agent stage 2 — staging + confirm flow (hr_agent_pending_actions).
//
// stageAction(): validates authority, stores the operation with a single-use
// code, and routes the confirm card to the right phone (self / HOO / owner).
// handleHrConfirmReply(): deterministic webhook hook (runs BEFORE any LLM) —
// "CONFIRM <code>" from the DESIGNATED confirmer's phone executes; anyone
// else's confirm is refused and logged. "REJECT <code>" kills it.
//
// Security properties: codes are single-use, expire in 15 min, and are bound
// to one confirmer's phone identity. Execution re-checks the registry mode at
// confirm time — flipping the kill switch mid-flight stops staged actions too.

import { prisma } from "@/lib/prisma";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { recordOutboundMessage } from "@/lib/whatsapp-store";
import { samePhone } from "@/lib/ops-pulse/inbound";
import { getAgentMode, logAgentAction } from "@celsius/agents/src/substrate";
import {
  type ActionType,
  type Requester,
  type StaffTarget,
  authorize,
  checkRateLimit,
  executeAction,
  newConfirmCode,
  resolveHOOUserRow,
  resolveOwnerUser,
} from "./write-ops";
import { HR_AGENT_KEY } from "./staff-assistant";

const EXPIRY_MIN = 15;
const CONFIRM_RE = /^\s*(confirm|ya|yes|ok(?:ay)?|setuju)\s+([a-z0-9]{4,8})\s*$/i;
const REJECT_RE = /^\s*(reject|batal|cancel|no|tolak)\s+([a-z0-9]{4,8})\s*$/i;

export interface StageResult {
  staged: boolean;
  code?: string;
  confirmWith?: "you" | "HOO" | "owner";
  message: string; // what the model should relay to the requester
}

export async function stageAction(params: {
  action: ActionType;
  payload: Record<string, unknown>;
  card: string;
  requester: Requester;
  target: StaffTarget | null;
}): Promise<StageResult> {
  const { action, payload, card, requester, target } = params;

  const mode = await getAgentMode(HR_AGENT_KEY);
  if (mode !== "armed") {
    // Shadow keeps the old behaviour: log the proposal, a human applies it.
    await logAgentAction({
      agentKey: HR_AGENT_KEY,
      kind: "proposal",
      summary: `${action}${target ? ` — ${target.name}` : ""} (by ${requester.name}, shadow)`,
      meta: { action, payload, requestedById: requester.id, shadow: true },
    });
    return { staged: false, message: "Agent writes are not armed — logged as a proposal for HQ to apply manually. Do NOT tell the requester the change is made." };
  }

  const authz = await authorize(action, requester, target, payload);
  if (!authz.allowed) {
    return { staged: false, message: `Not allowed: ${authz.reason}. Tell the requester plainly.` };
  }
  const rateErr = await checkRateLimit(requester.id);
  if (rateErr) return { staged: false, message: rateErr };

  // Resolve the confirmer identity.
  let confirmerId = requester.id;
  let confirmerPhone: string | null = null;
  let confirmWith: StageResult["confirmWith"] = "you";
  if (authz.confirmer === "hoo") {
    const hoo = await resolveHOOUserRow();
    if (!hoo) return { staged: false, message: "No HOO on file to confirm — escalate to the owner manually." };
    confirmerId = hoo.id;
    confirmerPhone = hoo.phone;
    confirmWith = "HOO";
  } else if (authz.confirmer === "owner") {
    const owner = await resolveOwnerUser();
    if (!owner) return { staged: false, message: "No owner on file to confirm." };
    confirmerId = owner.id;
    confirmerPhone = owner.phone;
    confirmWith = "owner";
  }

  const code = newConfirmCode();
  await prisma.$executeRaw`
    INSERT INTO hr_agent_pending_actions
      (code, action_type, payload, card, requested_by, requester_role, confirmer_id, expires_at)
    VALUES (${code}, ${action}, ${JSON.stringify(payload)}::jsonb, ${card},
            ${requester.id}, ${requester.role}, ${confirmerId},
            now() + (${EXPIRY_MIN} || ' minutes')::interval)
  `;
  await logAgentAction({
    agentKey: HR_AGENT_KEY,
    kind: "write_staged",
    summary: `${action}${target ? ` — ${target.name}` : ""} staged by ${requester.name} (confirm: ${confirmWith})`,
    meta: { action, code, payload, requestedById: requester.id, confirmerId },
  });

  // Cross-person confirmation: push the card to the confirmer's WhatsApp.
  if (confirmerId !== requester.id && confirmerPhone) {
    const text = `🧑‍🍳 HR change needs your OK (from ${requester.name}):\n\n${card}\n\nReply CONFIRM ${code} to apply, or REJECT ${code}. Expires in ${EXPIRY_MIN} min.`;
    const sent = await sendWhatsAppText(confirmerPhone, text);
    await recordOutboundMessage({
      waMessageId: sent.messageId,
      fromNumber: "",
      toNumber: confirmerPhone,
      type: "text",
      body: text,
      status: sent.ok ? "sent" : "failed",
      raw: { agent: HR_AGENT_KEY, pendingCode: code, ok: sent.ok, error: sent.error ?? null },
    });
    return {
      staged: true, code, confirmWith,
      message: `Staged. The ${confirmWith} has been sent the card and must reply CONFIRM ${code} within ${EXPIRY_MIN} minutes — tell the requester it's awaiting that approval. Nothing is applied yet.`,
    };
  }
  return {
    staged: true, code, confirmWith: "you",
    message: `Staged, nothing applied yet. Show the requester the card and tell them to reply "CONFIRM ${code}" (or "REJECT ${code}") within ${EXPIRY_MIN} minutes to execute.`,
  };
}

// ── Webhook hook: deterministic confirm/reject, pre-LLM ─────────────────────

export async function handleHrConfirmReply(fromNumber: string, text: string | null): Promise<boolean> {
  const body = (text ?? "").trim();
  const confirm = body.match(CONFIRM_RE);
  const reject = body.match(REJECT_RE);
  if (!confirm && !reject) return false;
  const code = (confirm ?? reject)![2].toUpperCase();

  try {
    // Lazy expiry sweep, then load the pending action.
    await prisma.$executeRaw`
      UPDATE hr_agent_pending_actions SET status = 'expired' WHERE status = 'pending' AND expires_at < now()
    `;
    const rows = await prisma.$queryRaw<
      Array<{ id: string; action_type: string; payload: unknown; card: string; requested_by: string; confirmer_id: string; status: string }>
    >`
      SELECT id, action_type, payload, card, requested_by, confirmer_id, status
      FROM hr_agent_pending_actions WHERE code = ${code}
    `;
    const row = rows[0];
    if (!row) return false; // unknown code — not ours to consume
    const reply = (t: string) => replyAndRecord(fromNumber, t);

    if (row.status !== "pending") {
      await reply(`Code ${code} is already ${row.status}.`);
      return true;
    }

    // Identity: only the designated confirmer's phone may act on this code.
    const confirmer = await prisma.user.findUnique({
      where: { id: row.confirmer_id },
      select: { id: true, name: true, phone: true },
    });
    if (!confirmer?.phone || !samePhone(fromNumber, confirmer.phone)) {
      await logAgentAction({
        agentKey: HR_AGENT_KEY,
        kind: "confirm_refused",
        summary: `wrong phone tried ${confirm ? "CONFIRM" : "REJECT"} ${code}`,
        meta: { code, fromNumber: fromNumber.slice(-4) },
      });
      await reply(`Only ${confirmer?.name ?? "the designated approver"} can act on ${code}.`);
      return true;
    }

    if (reject) {
      await prisma.$executeRaw`
        UPDATE hr_agent_pending_actions SET status = 'rejected', executed_at = now() WHERE id = ${row.id}::uuid
      `;
      await logAgentAction({ agentKey: HR_AGENT_KEY, kind: "write_rejected", summary: `${row.action_type} ${code} rejected by ${confirmer.name}`, meta: { code } });
      await reply(`❌ ${code} rejected — nothing applied.`);
      await notifyRequester(row.requested_by, confirmer.id, `Your HR change (${code}) was rejected by ${confirmer.name}.`);
      return true;
    }

    // Kill switch re-check at execution time.
    if ((await getAgentMode(HR_AGENT_KEY)) !== "armed") {
      await reply("HR agent writes are switched off right now — nothing applied.");
      return true;
    }

    let summary: string;
    try {
      summary = await executeAction(row.action_type as ActionType, (row.payload ?? {}) as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "execution failed";
      await prisma.$executeRaw`
        UPDATE hr_agent_pending_actions SET status = 'rejected', executed_at = now(),
               result = ${JSON.stringify({ error: msg })}::jsonb WHERE id = ${row.id}::uuid
      `;
      await logAgentAction({ agentKey: HR_AGENT_KEY, kind: "write_failed", summary: `${row.action_type} ${code}: ${msg}`.slice(0, 400), meta: { code, error: msg } });
      await reply(`⚠️ Couldn't apply ${code}: ${msg}\nRe-stage the request with the correction.`);
      return true;
    }

    await prisma.$executeRaw`
      UPDATE hr_agent_pending_actions SET status = 'executed', executed_at = now(),
             result = ${JSON.stringify({ summary })}::jsonb WHERE id = ${row.id}::uuid
    `;
    await logAgentAction({
      agentKey: HR_AGENT_KEY,
      kind: "write_executed",
      summary: `${row.action_type} ${code}: ${summary}`.slice(0, 400),
      meta: { code, action: row.action_type, requestedById: row.requested_by, confirmedBy: confirmer.id },
    });
    await reply(summary);
    await notifyRequester(row.requested_by, confirmer.id, `${summary}\n(confirmed by ${confirmer.name}, code ${code})`);
    return true;
  } catch (err) {
    console.error("[hr-agent:confirm] failed:", err instanceof Error ? err.message : err);
    return true; // looked like a confirm — never let it fall through to other flows
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
    raw: { agent: HR_AGENT_KEY, confirmFlow: true, ok: sent.ok, error: sent.error ?? null },
  });
}

async function notifyRequester(requestedById: string, confirmerId: string, text: string): Promise<void> {
  if (requestedById === confirmerId) return;
  const requester = await prisma.user.findUnique({ where: { id: requestedById }, select: { phone: true } });
  if (requester?.phone) await replyAndRecord(requester.phone, text);
}
