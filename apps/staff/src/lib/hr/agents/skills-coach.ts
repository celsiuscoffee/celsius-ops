// AI skills coach — interprets a staff member's audit history into actionable
// coaching insights. Cached in staff_skill_coach_cache keyed on the latest
// completed audit so we only call Claude when there's actually new data.
//
// Mirror of apps/backoffice/src/lib/hr/agents/skills-coach.ts. We intentionally
// keep two copies (one per app) instead of a shared package — each app has its
// own prisma + supabase wiring, and the agent's prompt is tight enough that
// the duplication is cheaper than a new shared package.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";

const MODEL = "claude-sonnet-4-6";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type CoachInsights = {
  summary: string;
  strengths: string[];
  focus_areas: string[];
  coaching_actions: string[];
  needs_more_data: boolean;
};

export type CoachResult = {
  insights: CoachInsights | null;
  generated_at: string | null;
  model: string | null;
  cached: boolean;
  audit_count: number;
  reason?: "no_audits" | "insufficient_data";
};

type AuditRow = {
  id: string;
  date: Date;
  overallScore: { toNumber(): number } | number | null;
  template: { id: string; name: string };
  items: Array<{ itemTitle: string; sectionName: string; rating: number | null; ratingType: string }>;
};

function buildPrompt(staffName: string, jobRole: string | null, audits: AuditRow[]): string {
  const auditLines = audits
    .map((a, i) => {
      const score =
        typeof a.overallScore === "number"
          ? a.overallScore
          : a.overallScore?.toNumber() ?? null;
      const items = a.items
        .map((it) => `      ${it.itemTitle}: ${it.rating ?? "—"}/5`)
        .join("\n");
      return `  Audit ${i + 1} (${a.date.toISOString().split("T")[0]}, ${a.template.name}, overall ${score ?? "—"}%):\n${items}`;
    })
    .join("\n\n");

  return `You are a sharp F&B operations coach. Below is a staff member's skill-audit history at Celsius Coffee. Each audit is photo-evidenced and rated 1-5 per skill.

Staff: ${staffName}
Role: ${jobRole ?? "(unknown)"}
Audit history (oldest to newest):

${auditLines}

Analyze the trend. Identify:
1. STRENGTHS: skills consistently high (4+) or improving meaningfully (delta ≥+1)
2. FOCUS_AREAS: skills consistently low (≤2) or regressing (delta ≤-1)
3. COACHING_ACTIONS: 2-3 concrete actions a manager can take *this week*. Name specific skills. No platitudes.
4. SUMMARY: 1-2 sentences. Tell the manager what's actually happening.

Rules:
- Only flag a regression if it's across 2+ audits, not single-audit noise.
- Coaching actions must be specific (e.g. "30-min milk-technique session with Head Barista") not generic ("provide more training").
- If there are <2 audits or all items have the same rating, set needs_more_data=true and leave arrays empty.

Return ONLY valid JSON, no markdown:
{
  "summary": "...",
  "strengths": ["..."],
  "focus_areas": ["..."],
  "coaching_actions": ["..."],
  "needs_more_data": false
}`;
}

export async function getSkillsCoachInsights(userId: string): Promise<CoachResult> {
  const [user, audits] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, fullName: true },
    }),
    prisma.auditReport.findMany({
      where: {
        auditeeId: userId,
        status: "COMPLETED",
        template: { auditTarget: "STAFF" },
      },
      select: {
        id: true,
        date: true,
        overallScore: true,
        template: { select: { id: true, name: true, jobRoleFilter: true } },
        items: {
          select: { itemTitle: true, sectionName: true, rating: true, ratingType: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  if (!user) {
    return { insights: null, generated_at: null, model: null, cached: false, audit_count: 0, reason: "no_audits" };
  }
  if (audits.length === 0) {
    return { insights: null, generated_at: null, model: null, cached: false, audit_count: 0, reason: "no_audits" };
  }
  if (audits.length < 2) {
    return {
      insights: {
        summary: "Only one audit on file — need at least two completed audits to spot a trend.",
        strengths: [],
        focus_areas: [],
        coaching_actions: [],
        needs_more_data: true,
      },
      generated_at: new Date().toISOString(),
      model: null,
      cached: false,
      audit_count: 1,
    };
  }

  const latestId = audits[audits.length - 1].id;

  const { data: cached } = await supabaseAdmin
    .from("staff_skill_coach_cache")
    .select("latest_audit_id, insights, model, generated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (cached?.latest_audit_id === latestId && cached?.insights) {
    return {
      insights: cached.insights as CoachInsights,
      generated_at: cached.generated_at as string,
      model: (cached.model as string) ?? null,
      cached: true,
      audit_count: audits.length,
    };
  }

  const jobRole = audits[0].template.jobRoleFilter ?? null;
  const staffName = user.fullName ?? user.name;
  const prompt = buildPrompt(staffName, jobRole, audits);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  let insights: CoachInsights;
  try {
    const parsed = JSON.parse(jsonStr) as CoachInsights;
    insights = {
      summary: parsed.summary ?? "",
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      focus_areas: Array.isArray(parsed.focus_areas) ? parsed.focus_areas : [],
      coaching_actions: Array.isArray(parsed.coaching_actions) ? parsed.coaching_actions : [],
      needs_more_data: !!parsed.needs_more_data,
    };
  } catch {
    return {
      insights: null,
      generated_at: null,
      model: null,
      cached: false,
      audit_count: audits.length,
      reason: "insufficient_data",
    };
  }

  await supabaseAdmin.from("staff_skill_coach_cache").upsert(
    {
      user_id: userId,
      latest_audit_id: latestId,
      insights,
      model: MODEL,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return {
    insights,
    generated_at: new Date().toISOString(),
    model: MODEL,
    cached: false,
    audit_count: audits.length,
  };
}
