import { createSupabaseClient, createSupabaseAdmin } from "@celsius/shared";

export const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

// Service-role client for cross-staff reads (e.g. the audit staff picker
// needs to read other employees' hr_employee_profiles, which RLS blocks for
// the anon client). Server-side only — never import from a client component.
export const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
