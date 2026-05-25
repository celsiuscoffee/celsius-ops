import { NextRequest, NextResponse } from "next/server";
import { checkModuleAccess } from "@/lib/check-module-access";

// Proxy to backoffice's /api/inventory/invoices/[id]/shortlink. Native
// POP-via-WhatsApp flow needs the same shortlink the backoffice prints
// on the receipt, so go through the same generator.
const BACKOFFICE_URL =
  process.env.BACKOFFICE_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKOFFICE_URL ||
  "https://backoffice.celsiuscoffee.com";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await checkModuleAccess(req, "inventory:invoices");
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const auth = req.headers.get("authorization") ?? "";
  const target = `${BACKOFFICE_URL}/api/inventory/invoices/${id}/shortlink`;

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to reach backoffice shortlink",
      },
      { status: 502 },
    );
  }
}
