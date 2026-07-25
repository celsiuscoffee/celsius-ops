import { supabaseAdmin } from "@/lib/supabase";

// Availability (weekly pattern + blockout dates) is a part-timer / intern
// feature only (owner 2026-07-25): full-timers and contract staff work a fixed
// roster and have no weekly pattern to declare. Same flexible-worker set the
// open-shifts booking gate uses.
export const AVAILABILITY_EMPLOYMENT_TYPES = ["part_time", "intern"] as const;

export async function isAvailabilityEligible(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("hr_employee_profiles")
    .select("employment_type")
    .eq("user_id", userId)
    .maybeSingle();
  return (AVAILABILITY_EMPLOYMENT_TYPES as readonly string[]).includes(data?.employment_type ?? "");
}
