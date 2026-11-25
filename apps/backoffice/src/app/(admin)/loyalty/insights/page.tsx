import { redirect } from "next/navigation";

// Loyalty AI Insights had no links in and its quick actions pointed at /admin/* pages that do not exist.
// Retired 2026-11-12 (docs/design/backoffice-structure.md · duplicate audit).
// The route permanently redirects so old bookmarks and links keep working;
// access is gated on the target page.
export default function LoyaltyInsightsRedirect() {
  redirect("/loyalty/members");
}
