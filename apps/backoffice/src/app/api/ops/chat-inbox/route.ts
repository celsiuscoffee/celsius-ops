import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listThreads } from "@/lib/wa-messages";

// Roles allowed to read the chat inbox. The sidebar already hides it unless the
// user has ops:chat-inbox (OWNER/ADMIN always); this is the API-side backstop.
const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// GET — every WhatsApp conversation, grouped per staff member, newest first.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const threads = await listThreads(new Date());
  return NextResponse.json({ threads });
}
