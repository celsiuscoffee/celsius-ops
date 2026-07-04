// Period-lock helpers. The DB trigger fin_check_period_open already refuses
// posting into a closed period, but its raise comes back as an opaque 500.
// Routes call this first to return a friendly 400 instead.

import { getFinanceClient } from "./supabase";

// Returns the period key (YYYY-MM) for a YYYY-MM-DD date string.
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

// True when the fin_periods row for this company + period is closed.
// A missing row means the period was never touched, which counts as open
// (the posting trigger auto-creates it as 'open').
export async function isPeriodClosed(companyId: string, date: string): Promise<boolean> {
  const client = getFinanceClient();
  const { data } = await client
    .from("fin_periods")
    .select("status")
    .eq("company_id", companyId)
    .eq("period", periodOf(date))
    .maybeSingle();
  return data?.status === "closed";
}
