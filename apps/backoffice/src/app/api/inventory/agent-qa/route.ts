import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserFromHeaders } from "@/lib/auth";
import { verifierEnabled, verifyRecentUnverified } from "@/lib/inventory/agents/verifier-run";

// Agent QA — recent supplier-chat agent decisions with the independent
// verifier's verdict. GET lists; POST runs the verifier over recent unverified
// decisions (on-demand, since there's no scheduler here).

const digits = (s: string | null | undefined) => (s ?? "").replace(/[^0-9]/g, "");

type VerifierVerdict = {
  rating: "pass" | "concern" | "fail";
  confidence: number;
  issues: string[];
  summary: string;
  recommendedAction: string | null;
  at?: string;
};

export async function GET(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Recent outbound messages; agent decisions are the ones carrying raw.agent.
  // Filter in JS rather than a fragile JSON-absence query.
  const recent = await prisma.whatsAppMessage.findMany({
    where: { direction: "outbound" },
    orderBy: { timestamp: "desc" },
    take: 250,
    select: { id: true, timestamp: true, toNumber: true, supplierId: true, raw: true },
  });
  const messages = recent.filter((m) => !!(m.raw as Record<string, unknown> | null)?.agent).slice(0, 100);

  const supplierIds = [...new Set(messages.map((m) => m.supplierId).filter(Boolean) as string[])];
  const suppliers = supplierIds.length
    ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));

  const rows = messages.map((m) => {
    const raw = (m.raw ?? {}) as Record<string, unknown>;
    const d = (raw.verifierDecision ?? {}) as Record<string, unknown>;
    const v = (raw.verifier ?? null) as VerifierVerdict | null;
    return {
      messageId: m.id,
      at: m.timestamp.toISOString(),
      key: digits(m.toNumber),
      supplierName: (m.supplierId && nameById.get(m.supplierId)) || "—",
      poNumber: typeof raw.poNumber === "string" ? raw.poNumber : null,
      intent: typeof d.intent === "string" ? d.intent : String(raw.intent ?? "—"),
      actionType: typeof d.actionType === "string" ? d.actionType : "none",
      appliedAction: typeof d.appliedAction === "string" ? d.appliedAction : String(raw.appliedAction ?? "none"),
      escalated: d.escalated === true || raw.escalated === true,
      confidence: typeof d.confidence === "number" ? d.confidence : Number(raw.confidence ?? 0),
      reSourced: d.reSourced === true || !!raw.reSource,
      hasSnapshot: !!raw.verifierInput && !!raw.verifierDecision,
      verifier: v
        ? {
            rating: v.rating,
            confidence: v.confidence,
            issues: Array.isArray(v.issues) ? v.issues : [],
            summary: v.summary ?? "",
            recommendedAction: v.recommendedAction ?? null,
          }
        : null,
    };
  });

  const counts = rows.reduce(
    (a, r) => {
      a.total++;
      if (r.escalated) a.escalated++;
      else if (r.appliedAction !== "none") a.autoActed++;
      if (r.verifier) {
        a.verified++;
        a[r.verifier.rating]++;
      } else if (r.hasSnapshot) {
        a.unverified++;
      }
      return a;
    },
    { total: 0, escalated: 0, autoActed: 0, verified: 0, unverified: 0, pass: 0, concern: 0, fail: 0 },
  );

  return NextResponse.json({ enabled: verifierEnabled(), counts, rows });
}

export async function POST(req: NextRequest) {
  const caller = await getUserFromHeaders(req.headers);
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!verifierEnabled()) {
    return NextResponse.json(
      { ok: false, enabled: false, error: "Verifier is off (set PROCUREMENT_VERIFIER_ENABLED=true and ANTHROPIC_API_KEY)." },
      { status: 200 },
    );
  }
  const result = await verifyRecentUnverified(15);
  return NextResponse.json({ ok: true, ...result });
}
