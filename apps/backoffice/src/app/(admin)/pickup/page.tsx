import { redirect } from "next/navigation";

// The pickup "Dashboard" repeated Pickup app analytics' charts (revenue, orders
// per day, by outlet, top products, orders by hour); its other cards live where
// the job is: live orders in Sales › Orders, low stock in Stock › Overview, new
// members in Customers › Members (restructure step 5, 17 Nov 2026).
export default function PickupDashboard() {
  redirect("/pickup/analytics");
}
