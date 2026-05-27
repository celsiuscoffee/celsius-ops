import { notFound } from "next/navigation";
import { getMenuData } from "@/lib/menu-data";
import { GlobalCartPill } from "../../_GlobalCartPill";
import { BottomNav } from "../../_BottomNav";
import { ProductView } from "./_ProductView";

/**
 * Product detail page — Server Component fetches the product (+
 * modifier groups) from the same getMenuData() the home/menu use,
 * passes it to a Client Component that handles modifier selection +
 * add-to-cart (writes to the SPA's persisted Zustand cart in
 * localStorage so the cart state is the same on every screen).
 */

export const revalidate = 60;

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const menu = await getMenuData();
  const product = menu.products.find((p) => p.id === id);
  if (!product) notFound();

  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <ProductView product={product} />
      <GlobalCartPill />
      <BottomNav active="menu" />
    </main>
  );
}
