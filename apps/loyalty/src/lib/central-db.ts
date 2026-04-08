import { createClient } from '@supabase/supabase-js';

// Central DB client — connects to the inventory/backoffice Supabase project
// Used for staff authentication (single source of truth)
const centralUrl = process.env.CENTRAL_SUPABASE_URL || '';
const centralKey = process.env.CENTRAL_SUPABASE_KEY || '';

export const centralDb = centralUrl && centralKey
  ? createClient(centralUrl, centralKey)
  : (null as unknown as ReturnType<typeof createClient>);
