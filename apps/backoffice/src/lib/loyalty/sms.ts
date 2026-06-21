export { sendSMS, getSMSProvider, providerAutoPrependsSender } from "@celsius/shared";
export type { SMSProvider } from "@celsius/shared";

import { resolveSmsProvider } from "@celsius/shared";
import { supabaseAdmin } from "@/lib/loyalty/supabase";

/** Active SMS gateway from the app_settings `sms_provider` toggle (env fallback). */
export function getActiveSmsProvider() {
  return resolveSmsProvider(supabaseAdmin);
}
