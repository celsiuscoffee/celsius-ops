import { NextRequest, NextResponse } from "next/server";
import { parseResponse } from "@/lib/ipay88/client";
import { settleIpay88Response } from "@/lib/ipay88/settle";

/**
 * iPay88 BackendURL — server-to-server result post (form-urlencoded).
 *
 * iPay88 keeps re-posting until it reads the exact body "RECEIVEOK", so we
 * acknowledge every well-formed post once we've acted on it, including a
 * mis-signed one (settleIpay88Response falls back to requery, so acking
 * can't strand a real payment). Settlement rules live in lib/ipay88/settle.
 * The path matches the CSRF middleware's /webhook exemption.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const r = parseResponse(form);
    const result = await settleIpay88Response(r);
    if (result.source === "error") {
      // Let iPay88 retry later — we couldn't act on it.
      return new NextResponse("ERROR", { status: 500, headers: { "Content-Type": "text/plain" } });
    }
    return new NextResponse("RECEIVEOK", { status: 200, headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    console.error("[ipay88 webhook] error:", err);
    return new NextResponse("ERROR", { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}
