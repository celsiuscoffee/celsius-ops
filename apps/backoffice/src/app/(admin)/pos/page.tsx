import { redirect } from "next/navigation";

// The POS landing page held only link cards to pages the menu and the reports tabs already reach.
// Retired 2026-11-12 (docs/design/backoffice-structure.md · duplicate audit).
// The route permanently redirects so old bookmarks and links keep working;
// access is gated on the target page.
export default function PosLandingRedirect() {
  redirect("/pos/reports");
}
