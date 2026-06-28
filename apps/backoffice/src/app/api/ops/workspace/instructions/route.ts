import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createAndSendInstruction, listInstructions, type AudienceInput } from "@/lib/ops-instructions";

export const dynamic = "force-dynamic";

const ALLOWED = ["OWNER", "ADMIN", "MANAGER"];

// GET — recent instructions (scoped) + the audience picker options (staff,
// active outlets, disciplines).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const scope = { userId: session.id, role: session.role };
  const [instructions, staff, outlets] = await Promise.all([
    listInstructions(scope),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, fullName: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.outlet.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    instructions,
    options: {
      staff: staff.map((u) => ({ id: u.id, name: u.fullName || u.name, role: u.role })),
      outlets,
      disciplines: [
        { key: "operations", label: "Operations leads" },
        { key: "barista", label: "Barista lead" },
        { key: "kitchen", label: "Kitchen lead" },
      ],
    },
  });
}

const audienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("users"), userIds: z.array(z.string()).min(1) }),
  z.object({ type: z.literal("outlet"), outletId: z.string().min(1) }),
  z.object({ type: z.literal("discipline"), routeKey: z.enum(["operations", "barista", "kitchen"]) }),
  z.object({ type: z.literal("all_managers") }),
]);

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(2000).optional().default(""),
  severity: z.enum(["normal", "important", "urgent"]).optional().default("normal"),
  audience: audienceSchema,
});

// POST — compose + fan out an instruction over WhatsApp, tracking each recipient.
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ALLOWED.includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const result = await createAndSendInstruction({
    title: body.title,
    body: body.body,
    severity: body.severity,
    audience: body.audience as AudienceInput,
    createdByUserId: session.id,
  });

  if (result.total === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_recipients",
        message:
          "Nobody resolved for that audience — e.g. no one is on a published shift at that outlet today. Pick staff directly or a different group.",
        ...result,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
