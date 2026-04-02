import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyPassword, createToken, setAuthCookie } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

// POST - verify email + password, return JWT cookie
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Rate limit by email
    const rateCheck = await checkRateLimit(email, RATE_LIMITS.ADMIN_LOGIN);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${rateCheck.retryAfter} seconds.` },
        { status: 429 }
      );
    }

    // Fetch user including password hash
    const { data, error } = await supabaseAdmin
      .from("admin_users")
      .select("id, name, email, role, is_active, outlets, password_hash")
      .eq("email", email)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Verify password (supports both bcrypt and legacy plaintext)
    const valid = await verifyPassword(password, data.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Update last login timestamp
    await supabaseAdmin
      .from("admin_users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", data.id);

    // Create JWT token
    const token = await createToken({
      id: data.id,
      email: data.email,
      name: data.name,
      role: data.role,
    });

    // Set httpOnly cookie and return user data
    const response = NextResponse.json({
      user: {
        id: data.id,
        name: data.name,
        email: data.email,
        role: data.role,
        outlets: data.outlets,
      },
    });

    return setAuthCookie(response, token);
  } catch {
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
