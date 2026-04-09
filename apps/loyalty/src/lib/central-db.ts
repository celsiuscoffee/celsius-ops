import { createSupabaseClient } from "@celsius/shared";

// Central DB client -- connects to the inventory/backoffice Supabase project
// Used for staff authentication (single source of truth)
export const centralDb = createSupabaseClient(
  process.env.CENTRAL_SUPABASE_URL || "",
  process.env.CENTRAL_SUPABASE_KEY || "",
);
