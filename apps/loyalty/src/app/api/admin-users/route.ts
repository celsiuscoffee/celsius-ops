import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth, hashPassword } from "@/lib/auth";

// GET - fetch all admin users (requires auth, excludes password)
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .select("id, name, email, role, is_active, outlets, last_login_at, created_at")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST - create admin user (requires auth + admin role)
export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const body = await request.json();
  const { name, email, password, role, is_active, outlets } = body;
  if (!name || !email || !password)
    return NextResponse.json({ error: "name, email, password required" }, { status: 400 });

  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Hash password before storing
  const hashedPassword = await hashPassword(password);

  const id = `admin-${Date.now()}`;
  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .insert({
      id,
      name,
      email,
      password_hash: hashedPassword,
      role: role || "manager",
      is_active: is_active !== false,
      outlets: outlets || [],
    })
    .select("id, name, email, role, is_active, outlets, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PUT - update admin user (requires auth + admin role)
export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const body = await request.json();
  const { id, name, email, password, role, is_active, outlets } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email;
  if (password !== undefined) updates.password_hash = await hashPassword(password);
  if (role !== undefined) updates.role = role;
  if (is_active !== undefined) updates.is_active = is_active;
  if (outlets !== undefined) updates.outlets = outlets;

  const { data, error } = await supabaseAdmin
    .from("admin_users")
    .update(updates)
    .eq("id", id)
    .select("id, name, email, role, is_active, outlets, last_login_at, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE - delete admin user (requires auth + admin role)
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await supabaseAdmin.from("admin_users").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
