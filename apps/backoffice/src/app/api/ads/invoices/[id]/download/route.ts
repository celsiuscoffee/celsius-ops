import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(req.headers, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const inv = await prisma.adsInvoice.findUnique({ where: { id } });
  if (!inv || !inv.pdfStoragePath) {
    return NextResponse.json({ error: "Invoice PDF not available" }, { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_LOYALTY_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.LOYALTY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase env vars missing" }, { status: 500 });
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase.storage
    .from("ads-invoices")
    .createSignedUrl(inv.pdfStoragePath, 3600); // 1-hour signed URL

  if (error || !data) {
    return NextResponse.json({ error: "Failed to generate signed URL" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, expiresIn: 3600 });
}
