import { redirect } from "next/navigation";

// The Settings tile page repeated the Settings menu link for link; the menu is the one way in.
// Retired 2026-11-12 (docs/design/backoffice-structure.md · duplicate audit).
// The route permanently redirects so old bookmarks and links keep working;
// access is gated on the target page.
export default function SettingsHubRedirect() {
  redirect("/settings/outlets");
}
