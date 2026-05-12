import { NextResponse, NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { passwordResetEmail, sendEmail } from "@/lib/email";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes

function hashToken(raw: string) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function baseUrl(req: NextRequest) {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (env) return env.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("host") || "backoffice.celsiuscoffee.com";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const { limited, retryAfterMs } = await checkRateLimit(`forgot:${ip}`, 5, 60_000);
  if (limited) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const identifier: string = (body.identifier ?? body.email ?? "").toString().trim();
  if (!identifier) {
    return NextResponse.json({ error: "Email or username required" }, { status: 400 });
  }

  // Look up by email OR username, but only for backoffice-eligible roles.
  const isEmail = identifier.includes("@");
  const user = await prisma.user.findFirst({
    where: {
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN", "MANAGER"] },
      ...(isEmail
        ? { email: { equals: identifier, mode: "insensitive" } }
        : { username: identifier }),
    },
    select: { id: true, name: true, email: true },
  });

  // Only send if we have a deliverable email. Either way, return 200 to avoid
  // leaking which accounts exist.
  if (user?.email) {
    const raw = crypto.randomBytes(32).toString("base64url");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    const resetUrl = `${baseUrl(req)}/reset-password?token=${raw}`;
    const { html, text } = passwordResetEmail({ name: user.name, resetUrl });
    await sendEmail({
      to: user.email,
      subject: "Reset your Celsius Ops password",
      html,
      text,
    });
  }

  return NextResponse.json({ ok: true });
}
