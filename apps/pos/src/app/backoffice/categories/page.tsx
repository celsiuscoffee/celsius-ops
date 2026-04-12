"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase-browser";

const supabase = createClient();

type Category = { id: string; name: string; slug: string; position: number; count: number };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: cats }, { data: products }] = await Promise.all([
        supabase.from("categories").select("id, name, slug, position").order("position"),
        supabase.from("products").select("category"),
      ]);

      // Count products per category slug
      const counts: Record<string, number> = {};
      if (products) {
        for (const p of products) {
          const cat = p.category as string;
          if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
        }
      }

      if (cats) {
        setCategories(
          cats.map((c) => ({
            id: c.id as string,
            name: c.name as string,
            slug: c.slug as string,
            position: c.position as number,
            count: counts[c.slug as string] ?? 0,
          }))
        );
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="mt-1 text-sm text-text-muted">{categories.length} categories</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 text-center text-sm text-text-muted">Loading...</div>
      ) : (
        <div className="mt-4 space-y-2">
          {categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-xs text-text-dim">{cat.position}</span>
                <div>
                  <p className="text-sm font-medium">{cat.name}</p>
                  <p className="text-[10px] text-text-dim font-mono">{cat.slug}</p>
                </div>
              </div>
              <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-text-muted">{cat.count} products</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
