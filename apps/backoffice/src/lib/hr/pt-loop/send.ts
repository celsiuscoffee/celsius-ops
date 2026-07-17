// PT-loop outbound WhatsApp messages — availability ping, roster ack card,
// open-shift blast. Text-keyword protocol (v1): replies are plain text
// ("OK", "CANNOT Sat", "TAKE 4271"), parsed in inbound.ts. Every send is
// recorded in hr_wa_prompts.
//
// 24h-window caveat: sendWhatsAppText only reaches people who messaged us in
// the last 24h. For cold sends these must go out as APPROVED templates
// (sendWhatsAppTemplate) — template names TBD after Meta review; until then
// the cron should prefer text and surface failures in the digest.

import { sendWhatsAppText, isWhatsAppConfigured } from "@/lib/whatsapp";
import { recordPrompt } from "./prompts";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  return `${DOW[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
};
const fmtTime = (t: string) => t.slice(0, 5);

// Wed ping: ask for next week's availability in free text.
export async function sendAvailabilityPing(input: {
  userId: string;
  phone: string;
  name: string;
  weekStart: string; // the week being planned
}): Promise<boolean> {
  if (!isWhatsAppConfigured()) return false;
  const body =
    `Hi ${input.name.split(" ")[0]}! 📅 Celsius Coffee — availability check for next week ` +
    `(${fmtDate(input.weekStart)} onwards).\n\n` +
    `Reply with when you CAN work, in your own words — contoh: "boleh Sabtu Ahad full day, weekday lepas 3pm".\n\n` +
    `No reply = same availability as last week.`;
  const res = await sendWhatsAppText(input.phone, body);
  if (res.ok) {
    await recordPrompt({
      userId: input.userId,
      kind: "availability",
      weekStart: input.weekStart,
      wamid: res.messageId ?? null,
      payload: { phone: input.phone },
    });
  } else {
    console.error(`[pt-loop] availability ping failed for ${input.userId}: ${res.error}`);
  }
  return res.ok;
}

// Roster card on publish: the person's week + how to confirm.
export async function sendRosterAckCard(input: {
  userId: string;
  phone: string;
  name: string;
  weekStart: string;
  outletName: string;
  shifts: Array<{ id: string; shift_date: string; start_time: string; end_time: string; role_type: string | null }>;
}): Promise<boolean> {
  if (!isWhatsAppConfigured() || input.shifts.length === 0) return false;
  const lines = input.shifts
    .map((s) => `• ${fmtDate(s.shift_date)} ${fmtTime(s.start_time)}–${fmtTime(s.end_time)}${s.role_type ? ` (${s.role_type})` : ""}`)
    .join("\n");
  const body =
    `📋 Your shifts at ${input.outletName}, week of ${fmtDate(input.weekStart)}:\n\n${lines}\n\n` +
    `Reply *OK* to confirm all.\n` +
    `Can't make one? Reply *CANNOT <day>* (contoh: CANNOT Sat) — we'll cover it.\n` +
    `Please respond within 48 hours 🙏`;
  const res = await sendWhatsAppText(input.phone, body);
  if (res.ok) {
    await recordPrompt({
      userId: input.userId,
      kind: "roster_ack",
      weekStart: input.weekStart,
      wamid: res.messageId ?? null,
      payload: { shift_ids: input.shifts.map((s) => s.id), outlet: input.outletName },
    });
  } else {
    console.error(`[pt-loop] roster card failed for ${input.userId}: ${res.error}`);
  }
  return res.ok;
}

// Open-shift blast: first TAKE wins. `code` is the short claim code shown to
// staff (first 4 hex chars of the open-shift id — collision-checked at claim
// time against open shifts only, so ambiguity is bounded and rare).
export function openShiftCode(openShiftId: string): string {
  return openShiftId.replace(/-/g, "").slice(0, 4);
}

export async function sendOpenShiftBlast(input: {
  openShiftId: string;
  outletName: string;
  shiftDate: string;
  startTime: string;
  endTime: string;
  station: string;
  recipients: Array<{ userId: string; phone: string; name: string }>;
}): Promise<number> {
  if (!isWhatsAppConfigured()) return 0;
  const code = openShiftCode(input.openShiftId);
  const body =
    `🔔 OPEN SHIFT — ${input.outletName}\n` +
    `${fmtDate(input.shiftDate)} ${fmtTime(input.startTime)}–${fmtTime(input.endTime)} (${input.station})\n\n` +
    `First to reply *TAKE ${code}* gets it. 🏃`;
  let sent = 0;
  for (const r of input.recipients) {
    const res = await sendWhatsAppText(r.phone, body);
    if (res.ok) {
      sent++;
      await recordPrompt({
        userId: r.userId,
        kind: "open_shift",
        refId: input.openShiftId,
        weekStart: null,
        wamid: res.messageId ?? null,
        payload: { code },
      });
    }
  }
  return sent;
}
