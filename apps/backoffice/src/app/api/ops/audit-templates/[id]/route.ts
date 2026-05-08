import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@celsius/auth";

// GET — single template with all sections/items
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.auditTemplate.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      sections: {
        orderBy: { sortOrder: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(template);
}

// PATCH — update template metadata + replace sections/items
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { name, description, roleType, auditTarget, jobRoleFilter, isActive, sections } = body;

  // Update template fields
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (roleType !== undefined) data.roleType = roleType;
  if (isActive !== undefined) data.isActive = isActive;
  if (auditTarget !== undefined) {
    const target = auditTarget === "STAFF" ? "STAFF" : "OUTLET";
    data.auditTarget = target;
    // Clear filter when reverting to OUTLET so we don't carry stale role data.
    if (target === "OUTLET") data.jobRoleFilter = null;
  }
  if (jobRoleFilter !== undefined) data.jobRoleFilter = jobRoleFilter || null;

  // Cross-field validation: STAFF templates always need a jobRoleFilter.
  // Need to consider both the incoming patch and the persisted state.
  const targetAfter =
    (data.auditTarget as string | undefined) ??
    (await prisma.auditTemplate.findUnique({ where: { id }, select: { auditTarget: true } }))?.auditTarget;
  const filterAfter =
    data.jobRoleFilter !== undefined
      ? (data.jobRoleFilter as string | null)
      : (await prisma.auditTemplate.findUnique({ where: { id }, select: { jobRoleFilter: true } }))?.jobRoleFilter;
  if (targetAfter === "STAFF" && !filterAfter) {
    return NextResponse.json(
      { error: "jobRoleFilter required when auditTarget is STAFF" },
      { status: 400 },
    );
  }

  await prisma.auditTemplate.update({ where: { id }, data });

  // Replace sections + items if provided
  if (sections) {
    await prisma.$transaction(async (tx) => {
      // Delete existing sections (cascades to items)
      await tx.auditSection.deleteMany({ where: { templateId: id } });

      // Create new sections with items
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        await tx.auditSection.create({
          data: {
            templateId: id,
            name: sec.name,
            sortOrder: si,
            items: sec.items?.length
              ? {
                  create: sec.items.map((item: any, ii: number) => ({
                    title: item.title,
                    description: item.description || null,
                    photoRequired: item.photoRequired ?? false,
                    ratingType: item.ratingType || "pass_fail",
                    sortOrder: ii,
                  })),
                }
              : undefined,
          },
        });
      }
    });
  }

  const updated = await prisma.auditTemplate.findUnique({
    where: { id },
    include: { sections: { orderBy: { sortOrder: "asc" }, include: { items: { orderBy: { sortOrder: "asc" } } } } },
  });

  return NextResponse.json(updated);
}

// DELETE — delete template
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.auditTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
