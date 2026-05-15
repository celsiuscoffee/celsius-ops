import { redirect } from "next/navigation";

// Legacy route kept as a server-side redirect to the consolidated
// Engage page. The Push Reminders surface now lives as a tab inside
// /loyalty/engage so admins have one home for "how we reach customers"
// — automatic push + manual SMS — instead of two side-by-side nav
// entries. Old bookmarks and the brief window where the standalone
// nav entry shipped still resolve here.
export default function PushRemindersRedirect() {
  redirect("/loyalty/engage?tab=push");
}
