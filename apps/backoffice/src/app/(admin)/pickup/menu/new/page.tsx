"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { adminFetch } from "@/lib/pickup/admin-fetch";
import { ProductForm, type Category } from "../_ProductForm";

export default function NewProductPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminFetch("/api/pickup/products");
      const json = await res.json() as { categories: Category[] };
      if (cancelled) return;
      setCategories(json.categories ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <ProductForm product={null} categories={categories} />;
}
