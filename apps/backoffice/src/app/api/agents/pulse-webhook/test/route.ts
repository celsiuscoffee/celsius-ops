import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { askOwner } from "@celsius/agents/src/ask-owner";

export const dynamic = "force-dynamic";

// OWNER/ADMIN-only: fire a test confirmation to the pulse bot so you can verify
// the two-way flow end to end (buttons -> your tap -> recorded) without wiring a
// live agent. Tap a button in Telegram, then check /agents (the answer logs as a
// note) or re-hit to send another.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const promptId = await askOwner({
    agentKey: "system",
    kind: "confirm",
    prompt: "This is a two-way test. Tap a button to confirm the channel works.",
    options: [
      { label: "✅ Works", value: "works" },
      { label: "🛑 No", value: "no" },
    ],
    expiresInHours: 1,
  });
  if (!promptId) {
    return NextResponse.json(
      { ok: false, error: "Two-way not configured (need CELSIUS_PULSE_BOT_TOKEN + CELSIUS_PULSE_CHAT_ID) or send failed." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, promptId, note: "Tap a button in Telegram, then re-check." });
}
