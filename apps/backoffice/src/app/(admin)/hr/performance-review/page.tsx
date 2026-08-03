import { redirect } from "next/navigation";

// The performance review screen was merged into /hr/performance (owner
// 2026-08-03: "consolidate these two, remove the old build"). It shipped at
// this URL earlier the same day, so keep it resolving rather than 404ing
// anyone who bookmarked it. Safe to delete once nobody is using the old link.
export default function PerformanceReviewRedirect() {
  redirect("/hr/performance");
}
