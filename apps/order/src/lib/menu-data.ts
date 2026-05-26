/**
 * Server-side menu data fetcher.
 * Reads from Supabase products table — same source the POS register
 * reads. Schedule fields (start/end date, days of week, time window)
 * are enforced HERE so customer-facing surfaces hide products outside
 * their schedule. POS register ignores schedule and can sell anything.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { products as mockProducts, categories as mockCategories } from "@/data/mock";
import type { Product, Category } from "@/lib/types";
import { filterModifiersForChannel } from "@celsius/shared";

export interface MenuData {
  products: Product[];
  categories: Category[];
  source: "supabase" | "mock";
}

/** Asia/Kuala_Lumpur "now" as { dow, hhmm, yyyymmdd } so we can compare
 *  against schedule columns without dragging in a tz library. Reads UTC
 *  + adds the fixed +08:00 offset MYT uses year-round. */
function nowInMYT(): { dow: number; hhmm: string; yyyymmdd: string } {
  const now = new Date();
  const myt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // MYT = UTC+8
  const dow = myt.getUTCDay(); // 0=Sun..6=Sat
  const hh = String(myt.getUTCHours()).padStart(2, "0");
  const mm = String(myt.getUTCMinutes()).padStart(2, "0");
  const yyyy = myt.getUTCFullYear();
  const mo = String(myt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(myt.getUTCDate()).padStart(2, "0");
  return { dow, hhmm: `${hh}:${mm}`, yyyymmdd: `${yyyy}-${mo}-${dd}` };
}

/** True iff the product is "in schedule" right now (or schedule is unset). */
function isInSchedule(p: Record<string, unknown>): boolean {
  const startDate = p.schedule_start_date as string | null | undefined;
  const endDate   = p.schedule_end_date   as string | null | undefined;
  const days      = p.schedule_days_of_week as number[] | null | undefined;
  const timeFrom  = (p.schedule_time_from as string | null | undefined)?.slice(0, 5);
  const timeTo    = (p.schedule_time_to   as string | null | undefined)?.slice(0, 5);

  const hasAny = startDate || endDate || (days && days.length > 0) || timeFrom || timeTo;
  if (!hasAny) return true; // no schedule set = always available

  const { dow, hhmm, yyyymmdd } = nowInMYT();

  if (startDate && yyyymmdd < startDate) return false;
  if (endDate   && yyyymmdd > endDate)   return false;
  if (days && days.length > 0 && !days.includes(dow)) return false;

  if (timeFrom && timeTo) {
    if (timeTo > timeFrom) {
      // Same-day window: 09:00 → 17:00
      if (hhmm < timeFrom || hhmm >= timeTo) return false;
    } else {
      // Wrap past midnight: 22:00 → 02:00
      if (hhmm < timeFrom && hhmm >= timeTo) return false;
    }
  } else if (timeFrom && hhmm < timeFrom) {
    return false;
  } else if (timeTo && hhmm >= timeTo) {
    return false;
  }
  return true;
}

export async function getMenuData(): Promise<MenuData> {
  try {
    const supabase = getSupabaseAdmin();
    const [{ data: dbProducts, error: prodError }, { data: dbCategories, error: catError }] = await Promise.all([
      supabase
        .from("products")
        .select("id, name, category, description, price, image_url, is_available, is_featured, modifiers, featured_position, schedule_start_date, schedule_end_date, schedule_days_of_week, schedule_time_from, schedule_time_to")
        .eq("brand_id", "brand-celsius")
        .order("position")
        .order("name"),
      supabase
        .from("categories")
        .select("id, name, slug, position")
        .order("position"),
    ]);

    if (prodError) console.error("[menu-data] products query error:", prodError);
    if (catError)  console.error("[menu-data] categories query error:", catError);

    if (dbProducts && dbProducts.length > 0 && dbCategories && dbCategories.length > 0) {
      const inWindow = (dbProducts as Record<string, unknown>[]).filter(isInSchedule);
      const products: Product[] = inWindow.map((p) => ({
        id:             p.id as string,
        categoryId:     p.category as string,
        name:           p.name as string,
        description:    (p.description as string) || undefined,
        basePrice:      p.price as number,
        image:          (p.image_url as string) ?? "",
        isAvailable:    (p.is_available as boolean) ?? true,
        isPopular:      (p.is_featured as boolean) ?? false,
        isNew:          false,
        variants:       [],
        modifierGroups: filterModifiersForChannel(
          Array.isArray(p.modifiers) ? (p.modifiers as Product["modifierGroups"]) : [],
          "pickup",
        ),
        featuredPosition: (p.featured_position as number) ?? 9999,
      }));

      const categories: Category[] = (dbCategories as Record<string, unknown>[]).map((c) => ({
        id:   c.id as string,
        name: c.name as string,
        slug: c.slug as string,
      }));

      return { products, categories, source: "supabase" };
    }
  } catch (err) {
    console.error("[menu-data] Supabase fetch failed, using mock:", err);
  }

  return { products: mockProducts, categories: mockCategories, source: "mock" };
}
