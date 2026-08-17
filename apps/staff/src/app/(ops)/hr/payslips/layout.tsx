import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Payslips are open to every signed-in employee (owner 2026-08-03). This used to
// redirect anyone who was not OWNER/ADMIN which, together with
// PAYROLL_UI_ENABLED=false, meant no member of staff could reach their own
// payslip in this app at all.
//
// Authentication is still required and it is the only check that belongs here:
// /api/hr/payslips scopes every read to `session.id`, so a signed-in user can
// only ever see their own. A role check would add no security, it would just
// keep people from their own pay.
export default async function PayslipsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}
