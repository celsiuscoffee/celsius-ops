import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

/**
 * POS reads the product catalog + writes orders against the same
 * Supabase project as the web POS (kqdcdhpnyuwrxqhbuyfl), using the
 * public anon key. Anything that needs the service role (loyalty
 * mutations, etc.) goes through the POS Next.js API (lib/api.ts), not
 * this client.
 *
 * No auth session is persisted for the *cashier* here — staff login is
 * a PIN check against the API; this client is used anonymously for
 * RLS-public reads (products, categories, promotions, outlets).
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
  realtime: {
    // Cap reconnect churn — the register ↔ customer-display bridge is
    // the only realtime consumer and it tolerates a slow reconnect.
    params: { eventsPerSecond: 5 },
  },
});
