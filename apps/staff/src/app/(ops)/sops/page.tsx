import { redirect } from "next/navigation";
import { BACKOFFICE_URL } from "@/lib/backoffice-url";

// SOPs are written in the back office (Ops › SOPs). Staff follow them as
// checklists; this copy was reachable only from the old /dashboard
// (docs/design/staff-app-structure.md).
export default function Page() {
  redirect(`${BACKOFFICE_URL}/ops/sops`);
}
