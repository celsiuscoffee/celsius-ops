import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth";

/**
 * PUT /api/inventory/menus/[id]/plating
 *
 * Set or clear a menu item's plating / presentation note — the "plating
 * expectation" shown on its Recipe Card. Body: { platingNote: string | null }.
 * Blank/empty clears the note.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const raw = typeof body.platingNote === "string" ? body.platingNote.trim() : "";
  const platingNote = raw.length > 0 ? raw.slice(0, 2000) : null;

  const menu = await prisma.menu.findUnique({ where: { id } });
  if (!menu) return NextResponse.json({ error: "Menu not found" }, { status: 404 });

  await prisma.menu.update({ where: { id }, data: { platingNote } });
  return NextResponse.json({ id, platingNote });
}
