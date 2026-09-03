import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

// Availability (weekly pattern + blockout dates) is a part-timer tool — the AI
// scheduler fills strictly inside what they declare. Full-timers have
// manager-set fixed schedules, so the page is closed to them (interns
// self-schedule like part-timers). The API enforces the same gate.
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
  if (!["part_time", "intern"].includes((profile?.employment_type as string) ?? "")) {
    redirect("/hr");
  }
  return <>{children}</>;
}
