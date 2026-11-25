import { redirect } from "next/navigation";
import { BACKOFFICE_URL } from "@/lib/backoffice-url";

// Checklist schedules are set in the back office (Ops › Schedules); this copy
// was linked from nowhere (docs/design/staff-app-structure.md).
export default function Page() {
  redirect(`${BACKOFFICE_URL}/ops/schedules`);
}
