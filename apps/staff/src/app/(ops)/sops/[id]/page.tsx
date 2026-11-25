import { redirect } from "next/navigation";
import { BACKOFFICE_URL } from "@/lib/backoffice-url";

// SOPs are edited in the back office (docs/design/staff-app-structure.md).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`${BACKOFFICE_URL}/ops/sops/${encodeURIComponent(id)}`);
}
