export const dynamic = "force-dynamic";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { RM_OAUTH_HOST, postFollowingRedirects } from "@/lib/revenue-monster/client";

/**
 * TEMPORARY diagnostic for the 2026-11-24 RM token outage.
 *
 * Every RM payment path began failing at 20:22 MYT with
 * `RM token failed: 405 <!doctypehtml><html lang="zh-cn">...` — an Alibaba
 * Cloud edge page, not RM JSON, so the POST never reached RM's API. Our
 * config and code had not changed in months. This reports exactly what the
 * token endpoint answers, so the fix is evidence-based rather than guessed.
 *
 * NOT FOR PRODUCTION: refuses to run when VERCEL_ENV is production, so it is
 * inert if it ever lands on main. Delete once the outage is understood.
 *
 * It reveals no secret: credentials are sent but never echoed, and the
 * access token is reduced to a boolean.
 */
export async function GET() {
  if (process.env.VERCEL_ENV === "production") {
    return NextResponse.json({ error: "probe disabled in production" }, { status: 404 });
  }

  const url = `https://${RM_OAUTH_HOST}/v1/token`;
  const body = JSON.stringify({ grantType: "client_credentials" });
  const auth = `Basic ${Buffer.from(
    `${(process.env.RM_CLIENT_ID || "").trim()}:${(process.env.RM_CLIENT_SECRET || "").trim()}`,
  ).toString("base64")}`;

  const describe = async (res: Response) => ({
    status: res.status,
    contentType: res.headers.get("content-type"),
    location: res.headers.get("location"),
    server: res.headers.get("server"),
    bodyHead: (await res.text().catch(() => "")).slice(0, 300),
  });

  const out: Record<string, unknown> = {
    configuredOauthHost: RM_OAUTH_HOST,
    isSandboxHost: RM_OAUTH_HOST.startsWith("sb-"),
    hasClientId: Boolean((process.env.RM_CLIENT_ID || "").trim()),
    hasClientSecret: Boolean((process.env.RM_CLIENT_SECRET || "").trim()),
  };

  // 1) POST with redirects surfaced rather than followed — shows a Location
  //    if RM's edge is bouncing us (which silently turns POST into GET).
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    out.postManual = await describe(res);
  } catch (e) {
    out.postManual = { error: e instanceof Error ? e.message : String(e) };
  }

  // 2) The same POST through the new redirect-preserving helper — this is
  //    what the fix actually does, so a 200 here means the fix works.
  try {
    const { res, finalUrl, hops } = await postFollowingRedirects(url, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const described = await describe(res);
    out.postFollowed = { ...described, finalUrl, hops, bodyHead: undefined };
    out.tokenObtained = described.status === 200 && described.bodyHead.includes("accessToken");
  } catch (e) {
    out.postFollowed = { error: e instanceof Error ? e.message : String(e) };
  }

  // 3) A GET for contrast: if GET also returns the 405 edge page, that is
  //    positive evidence the production failure is a POST degraded to GET.
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: auth },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    out.getManual = await describe(res);
  } catch (e) {
    out.getManual = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(out);
}
