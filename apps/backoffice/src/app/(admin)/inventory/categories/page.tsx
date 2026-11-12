import { redirect } from "next/navigation";

// Item Categories was a copy of Groups & Storage: both read prisma.itemGroup, and Groups also manages storage areas.
// Retired 2026-11-12 (docs/design/backoffice-structure.md · duplicate audit).
// The route permanently redirects so old bookmarks and links keep working;
// access is gated on the target page.
export default function CategoriesRedirect() {
  redirect("/inventory/groups");
}
