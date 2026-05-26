"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { ProductForm, type DbProduct, type Category } from "../_ProductForm";

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<DbProduct | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await adminFetch("/api/pickup/products");
      const json = await res.json() as { products: DbProduct[]; categories: Category[] };
      if (cancelled) return;
      const p = (json.products ?? []).find((x) => x.id === id) ?? null;
      setProduct(p);
      setCategories(json.categories ?? []);
      setNotFound(!p);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Link href="/pickup/menu" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-[#160800]">
          <ArrowLeft className="h-4 w-4" /> Back to products
        </Link>
        <div className="bg-white rounded-2xl p-8 text-center">
          <p className="text-sm text-muted-foreground">Product not found.</p>
        </div>
      </div>
    );
  }

  return <ProductForm product={product} categories={categories} />;
}
