import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

// Availability is a PART-TIMER / intern feature only (owner 2026-07-25):
// full-timers work a fixed roster, so they have no weekly pattern to declare.
// Part-timers set their weekly pattern + blockout dates here and the AI
// scheduler fills strictly inside them. Non-PT are sent back to the HR home.
export default async function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/hr");
  }
  const { data: profile } = await supabaseAdmin
    .from("hr_employee_profiles")
    .select("employment_type")
    .eq("user_id", session.id)
    .maybeSingle();
  if (!["part_time", "intern"].includes(profile?.employment_type ?? "")) {
    redirect("/hr");
  }
  return <>{children}</>;
}
