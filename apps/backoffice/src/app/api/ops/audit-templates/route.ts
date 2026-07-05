import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@celsius/auth";

// GET — list all audit templates
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = await prisma.auditTemplate.findMany({
    include: {
      createdBy: { select: { id: true, name: true } },
      sections: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: { orderBy: { sortOrder: "asc" } },
        },
      },
      _count: { select: { reports: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

// POST — create a new template
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, roleType, auditTarget, jobRoleFilter, sections } = body;

  if (!name || !roleType) {
    return NextResponse.json({ error: "name and roleType required" }, { status: 400 });
  }

  // jobRoleFilter is String[] on AuditTemplate (multi-select). Accept either
  // an array (preferred) or a single string (legacy clients) and normalise.
  const jobRoleFilters: string[] = Array.isArray(jobRoleFilter)
    ? jobRoleFilter.filter((r): r is string => typeof r === "string" && r.length > 0)
    : typeof jobRoleFilter === "string" && jobRoleFilter.length > 0
      ? [jobRoleFilter]
      : [];

  const target = auditTarget === "STAFF" ? "STAFF" : "OUTLET";
  if (target === "STAFF" && jobRoleFilters.length === 0) {
    return NextResponse.json(
      { error: "jobRoleFilter required when auditTarget is STAFF" },
      { status: 400 },
    );
  }

  const template = await prisma.auditTemplate.create({
    data: {
      name,
      description: description || null,
      roleType,
      auditTarget: target,
      jobRoleFilter: target === "STAFF" ? jobRoleFilters : [],
      createdById: session.id,
      sections: sections?.length
        ? {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
            create: sections.map((sec: any, si: number) => ({
              name: sec.name,
              sortOrder: si,
              items: sec.items?.length
                ? {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy untyped DB row (ratchet: reduce, never add)
                    create: sec.items.map((item: any, ii: number) => ({
                      title: item.title,
                      description: item.description || null,
                      photoRequired: item.photoRequired ?? false,
                      ratingType: item.ratingType || "pass_fail",
                      sortOrder: ii,
                    })),
                  }
                : undefined,
            })),
          }
        : undefined,
    },
    include: { sections: { include: { items: true } } },
  });

  return NextResponse.json(template, { status: 201 });
}
