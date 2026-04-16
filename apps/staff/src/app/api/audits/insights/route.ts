import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ──────────────────────────────────────────────────────────

type Severity = "high" | "medium" | "low";

type Insight = {
  severity: Severity;
  finding: string;
  action: string;
  category: string;
};

type InsightsResponse = {
  focus: string;
  summary: string;
  insights: Insight[];
  basedOnAudits: number;
  lastAuditDate: string | null;
};

// ─── GET /api/audits/insights ───────────────────────────────────────
// AI-powered audit coach: analyzes past audits at this outlet and
// returns 2-3 concrete directions for TODAY'S spot check.

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const outletId = searchParams.get("outletId") || session.outletId;
    if (!outletId) {
      return NextResponse.json({ error: "outletId required" }, { status: 400 });
    }

    // Fetch last 30 days of completed audits with full item-level detail
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const audits = await prisma.auditReport.findMany({
      where: {
        outletId,
        status: "COMPLETED",
        completedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { completedAt: "desc" },
      take: 20,
      select: {
        id: true,
        date: true,
        overallScore: true,
        overallNotes: true,
        completedAt: true,
        template: { select: { name: true } },
        auditor: { select: { name: true } },
        items: {
          select: {
            rating: true,
            ratingType: true,
            notes: true,
            sectionName: true,
            itemTitle: true,
          },
        },
      },
    });

    // Not enough data — return empty insights gracefully
    if (audits.length === 0) {
      const empty: InsightsResponse = {
        focus: "No audit history yet",
        summary: "Complete your first audit to unlock AI-powered insights.",
        insights: [],
        basedOnAudits: 0,
        lastAuditDate: null,
      };
      return NextResponse.json(empty);
    }

    // ─── Prepare compact audit data for Claude ────────────────────
    // An item is "failed" if: rating is null (not checked), or rating === 0 (pass_fail fail),
    // or rating_3/rating_5 type with rating === 1 (lowest score)
    const isFailedItem = (item: { rating: number | null; ratingType: string }) => {
      if (item.rating === null) return false; // skipped, not a failure
      if (item.ratingType === "pass_fail") return item.rating === 0;
      if (item.ratingType === "rating_3") return item.rating === 1;
      if (item.ratingType === "rating_5") return item.rating <= 2;
      return false;
    };

    const auditSummaries = audits.map((a) => ({
      template: a.template.name,
      date: a.date.toISOString().split("T")[0],
      score: a.overallScore ? Number(a.overallScore) : null,
      auditor: a.auditor.name,
      failedItems: a.items.filter(isFailedItem).map((i) => ({
        section: i.sectionName,
        item: i.itemTitle,
        rating: i.rating,
        notes: i.notes,
      })),
      notes: a.overallNotes,
    }));

    // ─── Ask Claude for structured insights ────────────────────────
    const systemPrompt = `You are an operations coach for a specialty coffee shop chain. A manager is about to perform a spot-check audit. Analyze their past audit history and identify 2-3 specific, actionable patterns they should focus on TODAY.

Rules:
- Be specific and concrete. Reference actual findings from the data.
- Prioritize by severity (high/medium/low) based on frequency and impact.
- Each insight must have a clear ACTION the manager can take during today's audit.
- Keep findings and actions concise (1-2 sentences each).
- If data shows improvement, acknowledge it — don't invent problems.
- Never mention scores or templates that don't exist in the data.

Return ONLY valid JSON matching this schema:
{
  "focus": "Short title for today's main focus area (e.g. 'Food Safety Priority')",
  "summary": "One sentence overall trend description",
  "insights": [
    {
      "severity": "high" | "medium" | "low",
      "finding": "What the data shows (1-2 sentences)",
      "action": "What to do during today's audit (1 sentence)",
      "category": "Category name (e.g. 'Cleanliness', 'Food Quality')"
    }
  ]
}`;

    const userPrompt = `Analyze ${audits.length} audit${audits.length > 1 ? "s" : ""} from the last 30 days at this outlet.

Audit data (most recent first):
${JSON.stringify(auditSummaries, null, 2)}

Give me 2-3 actionable directions for today's spot check.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Extract text from response
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "AI returned no text response" },
        { status: 500 },
      );
    }

    // Parse JSON — Claude sometimes wraps in markdown code blocks
    let parsed: Omit<InsightsResponse, "basedOnAudits" | "lastAuditDate">;
    const cleanText = textBlock.text
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      parsed = JSON.parse(cleanText);
    } catch (err) {
      console.error("[audit-insights] JSON parse error:", err, cleanText);
      return NextResponse.json(
        { error: "Could not parse AI response" },
        { status: 500 },
      );
    }

    const response: InsightsResponse = {
      ...parsed,
      basedOnAudits: audits.length,
      lastAuditDate: audits[0]?.completedAt?.toISOString() ?? null,
    };

    return NextResponse.json(response, {
      headers: {
        // Cache for 30 min — insights don't need to be real-time
        "Cache-Control": "private, max-age=1800",
      },
    });
  } catch (err) {
    console.error("[audit-insights] error:", err);
    return NextResponse.json(
      { error: "Failed to generate insights" },
      { status: 500 },
    );
  }
}
