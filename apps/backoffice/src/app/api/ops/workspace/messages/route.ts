import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listOpsMessages, type OpsMessageFilters, type OpsMsgKind } from "@/lib/ops-messages";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// GET /api/ops/workspace/messages?days=7&kind=all&status=all&direction=all&q=&supplier=0
// The ops message monitor feed + summary counts.
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const filters: OpsMessageFilters = {
    days: Math.min(Math.max(Number(sp.get("days") || 7), 1), 60),
    kind: (sp.get("kind") || "all") as OpsMsgKind | "all",
    status: (sp.get("status") || "all") as "all" | "sent" | "failed",
    direction: (sp.get("direction") || "all") as "all" | "in" | "out",
    q: sp.get("q") || undefined,
    includeSupplier: sp.get("supplier") === "1",
  };

  const data = await listOpsMessages(filters);
  return NextResponse.json(data);
}
