import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const cookieStore = await cookies();
  const session = cookieStore.get("celsius-session");

  if (!session?.value) {
    redirect("/login");
  }

  redirect("/dashboard");
}
