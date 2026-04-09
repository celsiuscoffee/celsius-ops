import { notFound } from "next/navigation";
import { getMenuData } from "@/lib/menu-data";
import { ProductDetailContent } from "./_components/product-detail-content";

export const revalidate = 600;

// Pre-render all product pages at build time — zero Supabase calls at runtime
export async function generateStaticParams() {
  const { products } = await getMenuData();
  return products.map((p) => ({ productId: p.id }));
}

interface ProductDetailPageProps {
  params: Promise<{ productId: string }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { productId } = await params;
  const { products } = await getMenuData();
  const product = products.find((p) => p.id === productId);

  if (!product) notFound();

  return <ProductDetailContent product={product} />;
}
