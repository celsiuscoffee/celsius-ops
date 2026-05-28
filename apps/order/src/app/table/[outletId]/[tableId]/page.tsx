import { getSupabaseAdmin } from "@/lib/supabase/server";
import { TableEntry } from "./_TableEntry";

/**
 * Table-QR landing — the URL encoded on the in-store QR codes is
 * https://order.celsiuscoffee.com/table/{outletId}/{tableId}
 * (see apps/backoffice/.../pos/table-qr/page.tsx buildTableUrl).
 *
 * Scanning the QR lands here: we resolve the outlet name server-side,
 * then a tiny client component writes the dine-in context (outlet +
 * orderType "dine_in" + tableNumber) into the persisted store and
 * sends the customer straight to the menu — no outlet picker, no
 * pickup gate.
 */
export const revalidate = 60;

async function fetchOutletName(outletId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("outlet_settings")
      .select("name, is_active")
      .eq("store_id", outletId)
      .maybeSingle();
    if (!data || data.is_active === false) return null;
    return (data.name as string) ?? null;
  } catch {
    return null;
  }
}

export default async function TablePage({
  params,
}: {
  params: Promise<{ outletId: string; tableId: string }>;
}) {
  const { outletId, tableId } = await params;
  const outletName = await fetchOutletName(outletId);

  return (
    <main className="bg-white text-[#160800] min-h-screen">
      <TableEntry
        outletId={outletId}
        outletName={outletName}
        tableId={decodeURIComponent(tableId)}
      />
    </main>
  );
}
