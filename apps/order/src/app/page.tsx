import { getMenuData } from "@/lib/menu-data";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { HomeContent } from "./_components/home-content";
import type { PromoBanner } from "@/lib/supabase/types";

export const revalidate = 60;

const DEFAULT_BANNER: PromoBanner = {
  enabled:     true,
  label:       "New User Promo",
  headline:    "Buy 1",
  highlight:   "Free 1",
  description: "First app order · Any drink · Any size",
};

export default async function HomePage() {
  const supabase = getSupabaseAdmin();
  const [{ products }, { data: bannerRow }, { data: bgRow }] = await Promise.all([
    getMenuData(),
    supabase.from("app_settings").select("value").eq("key", "promo_banner").single(),
    supabase.from("app_settings").select("value").eq("key", "campaign_bg").single(),
  ]);

  const featured = products.filter((p) => p.isPopular || p.isNew).slice(0, 4);
  const featuredProducts = featured.length > 0 ? featured : products.slice(0, 4);
  const promoBanner: PromoBanner = bannerRow?.value
    ? { ...DEFAULT_BANNER, ...(bannerRow.value as Partial<PromoBanner>) }
    : DEFAULT_BANNER;
  const bgValue = bgRow?.value as { url?: string; enabled?: boolean } | null;
  const campaignBgUrl = bgValue?.enabled && bgValue?.url ? bgValue.url : null;

  return <HomeContent featuredProducts={featuredProducts} promoBanner={promoBanner} campaignBgUrl={campaignBgUrl} />;
}
