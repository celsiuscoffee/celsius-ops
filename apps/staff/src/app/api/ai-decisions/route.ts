import { NextRequest, NextResponse } from "next/server";
import { checkModuleAccess } from "@/lib/check-module-access";

// Proxy to backoffice's /api/inventory/ai-decisions. The backoffice
// endpoint is 562 lines of ranking / scoring logic — duplicating it
// in this app would be brittle, so the native PO "Smart" tab fans
// the request through here.
//
// The user's Bearer JWT is forwarded as-is. Both apps verify with the
// same @celsius/auth secret, so the backoffice's getSession() accepts
// it identically.
const BACKOFFICE_URL =
  process.env.BACKOFFICE_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_BACKOFFICE_URL ||
  "https://backoffice.celsiuscoffee.com";

export async function GET(req: NextRequest) {
  const guard = await checkModuleAccess(req, "inventory:orders");
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const outletId = url.searchParams.get("outletId");
  // Forward outletId. Backoffice scopes everything else server-side.
  const target = new URL(`${BACKOFFICE_URL}/api/inventory/ai-decisions`);
  if (outletId) target.searchParams.set("outletId", outletId);

  // Pass through the Authorization header so backoffice resolves the
  // same session. CSRF check on the backoffice side accepts Bearer
  // (no Origin needed for token auth).
  const auth = req.headers.get("authorization") ?? "";

  try {
    const upstream = await fetch(target.toString(), {
      method: "GET",
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        Accept: "application/json",
      },
      // AI decisions touches multiple tables + does ranking — give it
      // breathing room. Native UI shows a skeleton in the meantime.
      signal: AbortSignal.timeout(30_000),
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
            : "Failed to reach backoffice ai-decisions",
      },
      { status: 502 },
    );
  }
}
