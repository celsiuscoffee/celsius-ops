import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Overtime request module not yet opened to regular staff — only OWNER/ADMIN
// can preview. OT is captured automatically via attendance, not self-requested.
export default async function OvertimeLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    redirect("/hr");
  }
  return <>{children}</>;
}
