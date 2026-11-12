import { redirect } from "next/navigation";

// The Ops dashboard rendered the same /api/ops/performance data as Performance, which adds filters, trends and drill-downs.
// Retired 2026-11-12 (docs/design/backoffice-structure.md · duplicate audit).
// The route permanently redirects so old bookmarks and links keep working;
// access is gated on the target page.
export default function OpsDashboardRedirect() {
  redirect("/ops/performance");
}
