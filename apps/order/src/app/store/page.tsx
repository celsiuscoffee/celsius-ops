import { redirect } from "next/navigation";

/**
 * The pickup outlet picker has been retired — this app is table-QR (dine-in)
 * ordering only; pickup lives in the native Celsius app. Any lingering link or
 * bookmark to /store funnels to the scan wall.
 */
export default function StorePage() {
  redirect("/scan");
}
