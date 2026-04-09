import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// ONE-TIME migration endpoint — delete after use
export async function POST() {
  const supabase = getSupabaseAdmin();

  const statements = [
    `alter table outlet_settings add column if not exists rm_merchant_id   text`,
    `alter table outlet_settings add column if not exists rm_client_id     text`,
    `alter table outlet_settings add column if not exists rm_client_secret text`,
    `alter table outlet_settings add column if not exists rm_private_key   text`,
    `alter table outlet_settings add column if not exists rm_is_production boolean not null default false`,
    `alter table outlet_settings add column if not exists bukku_token      text`,
    `alter table outlet_settings add column if not exists bukku_subdomain  text`,
    `alter table outlet_settings add column if not exists rm_enabled       boolean not null default true`,
    `alter table outlet_settings add column if not exists bukku_enabled    boolean not null default true`,
    `alter table outlet_settings add column if not exists stripe_enabled   boolean not null default true`,
  ];

  const results: string[] = [];

  for (const sql of statements) {
    const { error } = await supabase.rpc("exec_migration", { sql_text: sql }).single();
    if (error) {
      // Try direct insert approach as fallback
      results.push(`${sql.slice(0, 60)}... → ${error.message}`);
    } else {
      results.push(`OK: ${sql.slice(0, 60)}...`);
    }
  }

  return NextResponse.json({ results });
}
