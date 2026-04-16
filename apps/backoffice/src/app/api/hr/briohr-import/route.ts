import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hrSupabaseAdmin } from "@/lib/hr/supabase";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type BrioEmployee = {
  briohr_id: string;       // CC001, CC006, etc.
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  office?: string;
  job_title?: string;
  employment_type?: string;
  join_date?: string;
  ic_number?: string;
  date_of_birth?: string;
  basic_salary?: number;
  hourly_rate?: number;
  epf_number?: string;
  socso_number?: string;
  tax_number?: string;
};

type MatchResult = {
  brio_employee: BrioEmployee;
  matches: Array<{ user_id: string; name: string; score: number; reason: string; already_linked: boolean }>;
  suggested_user_id: string | null;
};

/** Normalize name for matching: lowercase, remove titles/punctuation, collapse spaces */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(mr|ms|mrs|dr|bin|binti|bt|b\.|@)\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-based similarity: count shared words */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1.0;

  const tokensA = new Set(na.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(nb.split(" ").filter((t) => t.length > 1));

  const shared = [...tokensA].filter((t) => tokensB.has(t)).length;
  const total = Math.max(tokensA.size, tokensB.size);
  if (total === 0) return 0;
  return shared / total;
}

// GET: preview match candidates for current users
export async function GET() {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all active users
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true, name: true, email: true, phone: true,
      outlet: { select: { name: true } },
      role: true,
    },
    orderBy: { name: "asc" },
  });

  // Get existing linked BrioHR IDs
  const { data: profiles } = await hrSupabaseAdmin
    .from("hr_employee_profiles")
    .select("user_id, briohr_id");

  const linkedMap = new Map((profiles || []).map((p: { user_id: string; briohr_id: string }) => [p.user_id, p.briohr_id]));

  return NextResponse.json({
    users: users.map((u) => ({
      ...u,
      briohr_id: linkedMap.get(u.id) || null,
    })),
  });
}

// POST: match CSV data to users + optionally apply
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, employees, matches } = body as {
    action: "match" | "apply";
    employees?: BrioEmployee[];
    matches?: Array<{ briohr_id: string; user_id: string; brio_data: BrioEmployee }>;
  };

  // ─── Preview matches ───
  if (action === "match") {
    if (!employees || employees.length === 0) {
      return NextResponse.json({ error: "No employees provided" }, { status: 400 });
    }

    // Get all active users
    const users = await prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, email: true, phone: true },
    });

    // Get already-linked BrioHR IDs
    const { data: existingProfiles } = await hrSupabaseAdmin
      .from("hr_employee_profiles")
      .select("user_id, briohr_id");

    const linkedByBrioId = new Map((existingProfiles || []).map((p: { user_id: string; briohr_id: string | null }) => [p.briohr_id, p.user_id]));
    const linkedByUserId = new Map((existingProfiles || []).map((p: { user_id: string; briohr_id: string | null }) => [p.user_id, p.briohr_id]));

    const results: MatchResult[] = [];

    for (const brio of employees) {
      const candidates: MatchResult["matches"] = [];

      for (const user of users) {
        const nameScore = similarity(user.name, brio.name);
        let score = nameScore;
        const reasons: string[] = [];

        if (nameScore > 0) reasons.push(`name ${Math.round(nameScore * 100)}%`);

        // Boost if email matches
        if (brio.email && user.email && user.email.toLowerCase() === brio.email.toLowerCase()) {
          score = Math.max(score, 0.95);
          reasons.push("email match");
        }

        // Boost if phone matches
        if (brio.phone && user.phone) {
          const cleanUserPhone = user.phone.replace(/\D/g, "");
          const cleanBrioPhone = brio.phone.replace(/\D/g, "");
          if (cleanUserPhone.length > 5 && cleanUserPhone.endsWith(cleanBrioPhone.slice(-8))) {
            score = Math.max(score, 0.9);
            reasons.push("phone match");
          }
        }

        if (score > 0.3) {
          candidates.push({
            user_id: user.id,
            name: user.name,
            score,
            reason: reasons.join(", "),
            already_linked: linkedByUserId.get(user.id) === brio.briohr_id,
          });
        }
      }

      candidates.sort((a, b) => b.score - a.score);

      // Auto-suggest if top match is > 0.7 and not already linked to a different BrioHR ID
      const topMatch = candidates[0];
      const suggested = topMatch && topMatch.score >= 0.7
        ? (linkedByBrioId.has(brio.briohr_id) ? null : topMatch.user_id)
        : null;

      results.push({
        brio_employee: brio,
        matches: candidates.slice(0, 5),
        suggested_user_id: suggested,
      });
    }

    return NextResponse.json({ results });
  }

  // ─── Apply matches ───
  if (action === "apply") {
    if (!matches || matches.length === 0) {
      return NextResponse.json({ error: "No matches provided" }, { status: 400 });
    }

    let updated = 0;
    let created = 0;
    const errors: string[] = [];

    for (const m of matches) {
      try {
        const { data: existing } = await hrSupabaseAdmin
          .from("hr_employee_profiles")
          .select("id")
          .eq("user_id", m.user_id)
          .maybeSingle();

        const data: Record<string, unknown> = {
          briohr_id: m.briohr_id,
          briohr_imported_at: new Date().toISOString(),
          ic_number: m.brio_data.ic_number || null,
          date_of_birth: m.brio_data.date_of_birth || null,
          join_date: m.brio_data.join_date || new Date().toISOString().slice(0, 10),
          employment_type: m.brio_data.employment_type || "full_time",
          position: m.brio_data.job_title || null,
          basic_salary: m.brio_data.basic_salary || 0,
          hourly_rate: m.brio_data.hourly_rate || null,
          epf_number: m.brio_data.epf_number || null,
          socso_number: m.brio_data.socso_number || null,
          tax_number: m.brio_data.tax_number || null,
        };

        if (existing) {
          await hrSupabaseAdmin
            .from("hr_employee_profiles")
            .update({ ...data, updated_at: new Date().toISOString() })
            .eq("user_id", m.user_id);
          updated++;
        } else {
          await hrSupabaseAdmin
            .from("hr_employee_profiles")
            .insert({ user_id: m.user_id, ...data });
          created++;
        }
      } catch (e) {
        errors.push(`${m.briohr_id}: ${e instanceof Error ? e.message : "unknown"}`);
      }
    }

    return NextResponse.json({ updated, created, errors });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
