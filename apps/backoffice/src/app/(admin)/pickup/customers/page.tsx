import { redirect } from "next/navigation";

// The pickup Customers page was consolidated into the richer Rewards → Members
// customer page (advanced filters, segments, tags, tiers, item-purchase &
// channel filters, CSV export). This route now permanently redirects there so
// old bookmarks and deep links keep working. Access is gated on the target by
// loyalty:members.
export default function PickupCustomersRedirect() {
  redirect("/loyalty/members");
}
