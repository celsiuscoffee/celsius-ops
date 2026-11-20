import { redirect } from "next/navigation";

// Open shifts removed (owner, 20 Nov 2026: "follow gosame" — Gosamē's Staff
// app has no open-shift page; slots were switched off on 22 Jul). Old links
// land on Shifts.
export default function OpenShiftsRemoved() {
  redirect("/hr");
}
