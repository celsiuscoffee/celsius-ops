import { redirect } from "next/navigation";

// AI Decisions listed the same recommendations (and execute actions) already shown on Create PO, Transfers and Wastage.
// Retired 2026-11-12 (docs/design/backoffice-structure.md · duplicate audit).
// The route permanently redirects so old bookmarks and links keep working;
// access is gated on the target page.
export default function AiDecisionsRedirect() {
  redirect("/inventory/orders/create");
}
