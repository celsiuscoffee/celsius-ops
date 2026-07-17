// PT-loop inbound replies — the staff side of the WhatsApp loop.
// Text-keyword protocol (docs/design/pt-loop.md):
//   "OK" / "YES" / "CONFIRM"        → acknowledge the whole roster card
//   "CANNOT <day>" / "NO <day>"     → decline that day's shift → open shift
//   "TAKE <code>"                   → claim an open shift (first accept wins)
//   free text after availability ping → model-parsed weekly availability
// Wired into /api/whatsapp/webhook AFTER the ops-workspace acks and BEFORE the
// supplier flows, gated on the sender matching an ACTIVE staff phone with an
// outstanding prompt (so customer/supplier numbers never enter here).

import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { sendWhatsAppText } from "@/lib/whatsapp";
import { samePhone } from "@/lib/ops-pulse/inbound";
import { latestOpenPrompt, markResponded, type WaPrompt } from "./prompts";
import { openShiftCode, sendOpenShiftBlast } from "./send";

const MODEL = "claude-sonnet-4-6";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_TOKENS: Record<string, number> = {
  sun: 0, sunday: 0, ahad: 0,
  mon: 1, monday: 1, isnin: 1,
  tue: 2, tues: 2, tuesday: 2, selasa: 2,
  wed: 3, wednesday: 3, rabu: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, khamis: 4,
  fri: 5, friday: 5, jumaat: 5,
  sat: 6, saturday: 6, sabtu: 6,
};

// Same station classification the generator/Assist use (kitchen/chef/boh →
// kitchen; hybrid "Barista/Kitchen" fits both sides).
const isBOHPos = (p: string | null | undefined) => {
  const s = (p ?? "").toLowerCase();
  return s.includes("kitchen") || s.includes("chef") || s.includes("boh");
};
const fitsStation = (position: string | null, station: string) => {
  const p = (position ?? "").toLowerCase();
  return station === "kitchen" ? isBOHPos(position) : !isBOHPos(position) || p.includes("barista");
};

type StaffMatch = { id: string; name: string; phone: string };

// Sender phone → ACTIVE staff user. Bounded query (staff with phones).
async function matchStaffByPhone(from: string): Promise<StaffMatch | null> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", phone: { not: null }, role: { in: ["STAFF", "MANAGER"] } },
    select: { id: true, name: true, fullName: true, phone: true },
  });
  const u = users.find((x) => x.phone && samePhone(from, x.phone));
  return u ? { id: u.id, name: u.fullName || u.name || "Staff", phone: u.phone! } : null;
}

// Entry point from the webhook. Returns true when the message was consumed by
// the PT loop (callers must then skip the supplier flows).
export async function handleStaffLoopReply(from: string, text: string | null): Promise<boolean> {
  const body = (text ?? "").trim();
  if (!body) return false;

  // Fast path 1: open-shift claim by code — valid from anyone on staff,
  // regardless of what their latest prompt was.
  const take = body.match(/^\s*take\s+([0-9a-f]{4})\s*$/i);
  if (take) {
    const staff = await matchStaffByPhone(from);
    if (!staff) return false;
    await handleClaim(staff, take[1].toLowerCase());
    return true;
  }

  // Everything else must answer an outstanding prompt from a known staffer.
  const staff = await matchStaffByPhone(from);
  if (!staff) return false;
  const prompt = await latestOpenPrompt(staff.id);
  if (!prompt) return false;

  if (prompt.kind === "roster_ack") return handleRosterReply(staff, prompt, body);
  if (prompt.kind === "availability") return handleAvailabilityReply(staff, prompt, body);
  if (prompt.kind === "no_show") {
    // v1: any reply to a no-show nudge just closes the nudge; the cover blast
    // has its own lifecycle.
    await markResponded(prompt.id, { text: body });
    return true;
  }
  return false;
}

// ── Roster acknowledgment ───────────────────────────────────────────────────

async function handleRosterReply(staff: StaffMatch, prompt: WaPrompt, body: string): Promise<boolean> {
  const shiftIds = (prompt.payload?.shift_ids as string[] | undefined) ?? [];
  const lower = body.toLowerCase();

  if (/^(ok|okay|yes|ya|confirm|accept|boleh|👍)\b/.test(lower)) {
    if (shiftIds.length > 0) {
      await hrSupabaseAdmin
        .from("hr_schedule_shifts")
        .update({ ack_status: "acknowledged", acknowledged_at: new Date().toISOString() })
        .in("id", shiftIds)
        .eq("ack_status", "pending");
    }
    await markResponded(prompt.id, { action: "acknowledged_all", text: body });
    await sendWhatsAppText(staff.phone, `Confirmed ✅ See you there, ${staff.name.split(" ")[0]}!`);
    return true;
  }

  const cannot = lower.match(/^(?:cannot|can't|cant|no|tak boleh|xboleh)\s+(\w+)/);
  if (cannot) {
    const dow = DAY_TOKENS[cannot[1]];
    if (dow == null) {
      await sendWhatsAppText(staff.phone, `Which day? Reply CANNOT <day> — contoh: CANNOT Sat / CANNOT Sabtu.`);
      return true;
    }
    // Find that person's shift on that weekday among the card's shifts.
    const { data: shifts } = await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .select("id, schedule_id, shift_date, start_time, end_time, role_type, break_minutes, notes")
      .in("id", shiftIds.length ? shiftIds : ["00000000-0000-0000-0000-000000000000"]);
    const target = (shifts ?? []).find(
      (s) => new Date(s.shift_date + "T00:00:00Z").getUTCDay() === dow && s.start_time !== "00:00:00",
    );
    if (!target) {
      await sendWhatsAppText(staff.phone, `You don't have a shift on ${DOW[dow]} this week — nothing to change 👍`);
      return true;
    }
    await hrSupabaseAdmin
      .from("hr_schedule_shifts")
      .update({ ack_status: "declined", acknowledged_at: new Date().toISOString(), declined_reason: body })
      .eq("id", target.id);
    await markResponded(prompt.id, { action: "declined", shift_id: target.id, text: body });
    await convertToOpenShift(staff, target);
    await sendWhatsAppText(
      staff.phone,
      `Noted — your ${DOW[dow]} shift is released and we're finding cover. The rest of your week stays confirmed unless you tell us otherwise.`,
    );
    return true;
  }

  await sendWhatsAppText(
    staff.phone,
    `Reply *OK* to confirm your shifts, or *CANNOT <day>* if you can't make one (contoh: CANNOT Sat).`,
  );
  return true;
}

// Declined shift → hr_open_shifts row + blast to station-fit PTs at that outlet.
async function convertToOpenShift(
  decliner: StaffMatch,
  shift: { id: string; schedule_id: string; shift_date: string; start_time: string; end_time: string; role_type: string | null; break_minutes: number | null; notes: string | null },
): Promise<void> {
  const { data: sched } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("outlet_id")
    .eq("id", shift.schedule_id)
    .maybeSingle();
  if (!sched) return;
  const { data: profile } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("position")
    .eq("user_id", decliner.id)
    .maybeSingle();
  const station = isBOHPos(profile?.position) ? "kitchen" : "barista";

  const { data: open, error } = await hrSupabaseAdmin
    .from("hr_open_shifts")
    .insert({
      outlet_id: sched.outlet_id,
      shift_date: shift.shift_date,
      start_time: shift.start_time,
      end_time: shift.end_time,
      break_minutes: shift.break_minutes ?? 30,
      station,
      role_type: shift.role_type,
      template_id: shift.notes,
      source: "decline",
      status: "open",
    })
    .select("id")
    .single();
  if (error || !open) {
    console.error("[pt-loop] open-shift insert failed:", error?.message);
    return;
  }
  await blastOpenShift(open.id as string);
}

// Blast an open shift to eligible PTs (station fit, not the decliner's slot
// holder, not already rostered that day, phone on file).
export async function blastOpenShift(openShiftId: string): Promise<number> {
  const { data: os } = await hrSupabaseAdmin
    .from("hr_open_shifts")
    .select("*")
    .eq("id", openShiftId)
    .eq("status", "open")
    .maybeSingle();
  if (!os) return 0;
  const outlet = await prisma.outlet.findUnique({ where: { id: os.outlet_id }, select: { name: true } });

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      phone: { not: null },
      OR: [{ outletId: os.outlet_id }, { outletIds: { has: os.outlet_id } }],
    },
    select: { id: true, name: true, fullName: true, phone: true },
  });
  const ids = users.map((u) => u.id);
  const { data: profiles } = ids.length
    ? await hrSupabaseAdmin.from("hr_employee_profiles").select("user_id, position, employment_type").in("user_id", ids)
    : { data: [] as Array<{ user_id: string; position: string | null; employment_type: string | null }> };
  const profOf = new Map((profiles ?? []).map((p) => [p.user_id, p]));
  const { data: dayShifts } = ids.length
    ? await hrSupabaseAdmin.from("hr_schedule_shifts").select("user_id").in("user_id", ids).eq("shift_date", os.shift_date).neq("start_time", "00:00")
    : { data: [] as Array<{ user_id: string }> };
  const busy = new Set((dayShifts ?? []).map((s) => s.user_id));

  const recipients = users
    .filter((u) => {
      const p = profOf.get(u.id);
      if (!p || (p.employment_type !== "part_time" && p.employment_type !== "intern")) return false;
      return fitsStation(p.position, os.station) && !busy.has(u.id);
    })
    .map((u) => ({ userId: u.id, phone: u.phone!, name: u.fullName || u.name || "Staff" }));
  if (recipients.length === 0) return 0;

  return sendOpenShiftBlast({
    openShiftId,
    outletName: outlet?.name ?? "Celsius Coffee",
    shiftDate: os.shift_date,
    startTime: os.start_time,
    endTime: os.end_time,
    station: os.station,
    recipients,
  });
}

// ── Open-shift claim (first accept wins) ────────────────────────────────────

async function handleClaim(staff: StaffMatch, code: string): Promise<void> {
  const { data: opens } = await hrSupabaseAdmin
    .from("hr_open_shifts")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);
  const target = (opens ?? []).find((o) => openShiftCode(o.id) === code);
  if (!target) {
    await sendWhatsAppText(staff.phone, `That shift is no longer available — it may already be taken. 🙏`);
    return;
  }

  // Eligibility: station fit + not already rostered that day + not on leave.
  const { data: profile } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("position, employment_type")
    .eq("user_id", staff.id)
    .maybeSingle();
  if (!fitsStation(profile?.position ?? null, target.station)) {
    await sendWhatsAppText(staff.phone, `This one needs a ${target.station} position — we'll ping you for the next matching shift.`);
    return;
  }
  const { data: sameDay } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .select("id")
    .eq("user_id", staff.id)
    .eq("shift_date", target.shift_date)
    .neq("start_time", "00:00")
    .limit(1);
  if ((sameDay ?? []).length > 0) {
    await sendWhatsAppText(staff.phone, `You're already rostered that day — can't double-book you. 🙏`);
    return;
  }
  const { data: leave } = await hrSupabaseAdmin
    .from("hr_leave_requests")
    .select("id")
    .eq("user_id", staff.id)
    .in("status", ["approved", "ai_approved"])
    .lte("start_date", target.shift_date)
    .gte("end_date", target.shift_date)
    .limit(1);
  if ((leave ?? []).length > 0) {
    await sendWhatsAppText(staff.phone, `You're on leave that day — enjoy it! 🙏`);
    return;
  }

  // Optimistic claim: only wins if the row is still open (first accept).
  const { data: claimed } = await hrSupabaseAdmin
    .from("hr_open_shifts")
    .update({ status: "claimed", claimed_by: staff.id, claimed_at: new Date().toISOString() })
    .eq("id", target.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (!claimed) {
    await sendWhatsAppText(staff.phone, `Just missed it — someone claimed that shift first. Next one's yours! 🏃`);
    return;
  }

  // Materialize the real shift row on that week's schedule.
  const d = new Date(target.shift_date + "T00:00:00Z");
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
  const { data: sched } = await hrSupabaseAdmin
    .from("hr_schedules")
    .select("id")
    .eq("outlet_id", target.outlet_id)
    .eq("week_start", monday)
    .maybeSingle();
  if (!sched) {
    // Shouldn't happen (open shifts derive from an existing week) — release.
    await hrSupabaseAdmin.from("hr_open_shifts").update({ status: "open", claimed_by: null, claimed_at: null }).eq("id", target.id);
    await sendWhatsAppText(staff.phone, `Something went wrong on our side — please try again in a minute.`);
    return;
  }
  const { data: shiftRow, error: insErr } = await hrSupabaseAdmin
    .from("hr_schedule_shifts")
    .insert({
      schedule_id: sched.id,
      user_id: staff.id,
      shift_date: target.shift_date,
      start_time: target.start_time,
      end_time: target.end_time,
      role_type: target.role_type ?? (target.station === "kitchen" ? "Kitchen Cover" : "Cover"),
      break_minutes: target.break_minutes ?? 30,
      notes: target.template_id,
      ack_status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      is_ai_assigned: false,
    })
    .select("id")
    .single();
  if (insErr || !shiftRow) {
    console.error("[pt-loop] claim shift insert failed:", insErr?.message);
    await hrSupabaseAdmin.from("hr_open_shifts").update({ status: "open", claimed_by: null, claimed_at: null }).eq("id", target.id);
    await sendWhatsAppText(staff.phone, `Something went wrong on our side — please try again in a minute.`);
    return;
  }
  await hrSupabaseAdmin.from("hr_open_shifts").update({ claimed_shift_id: shiftRow.id }).eq("id", target.id);
  await sendWhatsAppText(
    staff.phone,
    `It's yours ✅ ${target.shift_date} ${target.start_time.slice(0, 5)}–${target.end_time.slice(0, 5)}. Thanks, ${staff.name.split(" ")[0]}!`,
  );
}

// ── Availability capture ────────────────────────────────────────────────────

async function handleAvailabilityReply(staff: StaffMatch, prompt: WaPrompt, body: string): Promise<boolean> {
  if (!process.env.ANTHROPIC_API_KEY) {
    await markResponded(prompt.id, { text: body, parsed: false });
    return true;
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: [
            `Parse a Malaysian cafe part-timer's weekly availability from their WhatsApp reply (English/Malay mix).`,
            `Reply: ${JSON.stringify(body)}`,
            `Return ONLY JSON: {"windows": [{"day_of_week": 0-6 (0=Sunday), "from": "HH:MM"|null, "until": "HH:MM"|null}], "note": "short summary"}.`,
            `A day they can work all day → from/until null. Days not mentioned are NOT available (omit them). "weekday" = Mon-Fri, "weekend" = Sat+Sun.`,
          ].join("\n"),
        },
      ],
    });
    const textOut = res.content.find((c) => c.type === "text")?.text ?? "";
    const json = JSON.parse(textOut.slice(textOut.indexOf("{"), textOut.lastIndexOf("}") + 1)) as {
      windows: Array<{ day_of_week: number; from: string | null; until: string | null }>;
      note?: string;
    };
    const windows = (json.windows ?? []).filter((w) => w.day_of_week >= 0 && w.day_of_week <= 6);
    if (windows.length === 0) throw new Error("no windows parsed");

    // Declaration replaces the previous one wholesale.
    await hrSupabaseAdmin.from("hr_staff_weekly_availability").delete().eq("user_id", staff.id);
    await hrSupabaseAdmin.from("hr_staff_weekly_availability").insert(
      windows.map((w) => ({
        user_id: staff.id,
        day_of_week: w.day_of_week,
        available_from: w.from,
        available_until: w.until,
      })),
    );
    await markResponded(prompt.id, { text: body, parsed: true, windows });

    const summary = windows
      .map((w) => `${DOW[w.day_of_week]}${w.from || w.until ? ` ${w.from ?? "open"}–${w.until ?? "close"}` : ""}`)
      .join(", ");
    await sendWhatsAppText(staff.phone, `Got it ✅ Available: ${summary}. Shifts will follow this — reply again anytime to change it.`);
    return true;
  } catch (err) {
    console.error("[pt-loop] availability parse failed:", err);
    await sendWhatsAppText(
      staff.phone,
      `Sorry, I didn't catch that — tell me the days (and times) you can work, contoh: "Sat Sun full day, Mon-Fri after 3pm".`,
    );
    return true; // consumed — don't let the supplier agent answer a staffer
  }
}
