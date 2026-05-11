import { getMenuData } from "@/lib/menu-data";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { HomeContent } from "./_components/home-content";

export const revalidate = 60;

export default async function HomePage() {
  const supabase = getSupabaseAdmin();
  const [{ products }, { data: bgRow }] = await Promise.all([
    getMenuData(),
    supabase.from("app_settings").select("value").eq("key", "campaign_bg").single(),
  ]);

  const featured = products.filter((p) => p.isPopular || p.isNew).slice(0, 4);
  const featuredProducts = featured.length > 0 ? featured : products.slice(0, 4);
  const bgValue = bgRow?.value as { url?: string; enabled?: boolean } | null;
  const campaignBgUrl = bgValue?.enabled && bgValue?.url ? bgValue.url : null;

  return <HomeContent featuredProducts={featuredProducts} campaignBgUrl={campaignBgUrl} />;
}
