import { redirect } from "next/navigation";
import { BACKOFFICE_URL } from "@/lib/backoffice-url";

// SOPs are written in the back office (docs/design/staff-app-structure.md).
export default function Page() {
  redirect(`${BACKOFFICE_URL}/ops/sops/new`);
}
