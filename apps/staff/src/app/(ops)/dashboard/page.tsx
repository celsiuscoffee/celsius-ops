import { redirect } from "next/navigation";

// Merged into Today (/home), which shows the outlet's checklists and the team's
// progress; SOP counts are a back-office job (docs/design/staff-app-structure.md).
export default function Page() {
  redirect("/home");
}
