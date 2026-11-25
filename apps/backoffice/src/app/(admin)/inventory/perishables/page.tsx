import { ItemsPage } from "@/components/inventory/items-page";

// Same editor as Ingredients (components/inventory/items-page.tsx), filtered to
// PERISHABLE items; keeps its own URL and the inventory:perishables grant.
export default function PerishablesPage() {
  return <ItemsPage kind="PERISHABLE" />;
}
