import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Open to all logged-in staff — part-timers declare their weekly pattern and
// blockout dates here; the AI scheduler fills strictly inside them.
export default async function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/hr");
  }
  return <>{children}</>;
}
