import { NextRequest, NextResponse } from "next/server";

// .trim() guards against accidental trailing newlines in env var values
const LOYALTY_BASE = (process.env.LOYALTY_BASE_URL ?? "https://loyalty.celsiuscoffee.com").trim();

// POST /api/loyalty/otp/send — proxy to loyalty app
export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone) return NextResponse.json({ success: false, error: "Phone required" }, { status: 400 });

    const res = await fetch(`${LOYALTY_BASE}/api/otp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, purpose: "login" }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error("Loyalty OTP send error:", err);
    return NextResponse.json({ success: false, error: "Failed to send OTP" }, { status: 500 });
  }
}
