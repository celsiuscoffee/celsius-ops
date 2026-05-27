import { getSupabaseAdmin } from "@/lib/supabase/server";
import { StoreList } from "./_StoreList";
import { BottomNav } from "../_BottomNav";

/**
 * Outlet picker. Server-fetches active outlets from Supabase; the
 * client component persists the chosen outlet to the SPA's localStorage
 * key so the rest of the app picks it up.
 */

export const revalidate = 60;

type Outlet = {
  store_id: string;
  name: string;
  address: string;
  is_open: boolean;
  is_busy: boolean;
  pickup_time_mins: number | null;
};

async function fetchOutlets(): Promise<Outlet[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("outlet_settings")
      .select("store_id, name, address, is_open, is_busy, pickup_time_mins, is_active")
      .eq("is_active", true);
    return (data ?? []).map((o) => ({
      store_id: o.store_id,
      name: o.name,
      address: o.address,
      is_open: o.is_open,
      is_busy: o.is_busy,
      pickup_time_mins: o.pickup_time_mins,
    }));
  } catch {
    return [];
  }
}

export default async function StorePage() {
  const outlets = await fetchOutlets();
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <StoreList outlets={outlets} />
      <BottomNav active="home" />
    </main>
  );
}
