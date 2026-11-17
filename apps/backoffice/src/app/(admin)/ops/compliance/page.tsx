import { redirect } from "next/navigation";

// SOP Compliance is now the Coverage panel at the top of SOP Schedules
// (ops/schedules/_coverage.tsx), where the gaps it finds are fixed.
export default function SopCompliance() {
  redirect("/ops/schedules");
}
