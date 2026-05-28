import { CartView } from "./_CartView";
import { BottomNav } from "../_BottomNav";
import { getMenuData } from "@/lib/menu-data";

/**
 * Cart screen. Cart state lives in localStorage (the SPA's persisted
 * Zustand store), so the contents have to render client-side — see
 * _CartView. The page is a Server Component so it can fetch best-
 * sellers for the empty-cart "Start with these" carousel.
 */
export const revalidate = 60;

export default async function CartPage() {
  const menu = await getMenuData();
  const bestSellers = menu.products
    .filter((p) => p.isPopular && p.isAvailable)
    .sort((a, b) => (a.featuredPosition ?? 9999) - (b.featuredPosition ?? 9999))
    .slice(0, 6)
    .map((p) => ({ id: p.id, name: p.name, basePrice: p.basePrice, image: p.image }));

  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <CartView bestSellers={bestSellers} />
      <BottomNav active="home" />
    </main>
  );
}
