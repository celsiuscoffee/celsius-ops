import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// Availability module not yet opened to regular staff — only OWNER/ADMIN can preview.
export default async function AvailabilityLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    redirect("/hr");
  }
  return <>{children}</>;
}
