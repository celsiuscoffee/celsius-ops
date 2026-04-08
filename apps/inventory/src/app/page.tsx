import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect("/staff");
  }
  // All admin management is at backoffice.celsiuscoffee.com
  // OWNER/ADMIN with a session still go to /home (staff-facing inventory app)
  redirect("/home");
}
