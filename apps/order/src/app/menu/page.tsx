import { Suspense } from "react";
import { getMenuData } from "@/lib/menu-data";
import { MenuContent } from "./_components/menu-content";
import MenuLoading from "./loading";

export const revalidate = 600; // re-fetch menu data at most every 10 min

export default async function MenuPage() {
  const { products, categories } = await getMenuData();

  return (
    <Suspense fallback={<MenuLoading />}>
      <MenuContent products={products} categories={categories} />
    </Suspense>
  );
}
