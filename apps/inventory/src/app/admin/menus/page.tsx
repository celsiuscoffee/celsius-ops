"use client";

import { useState, useEffect, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, ChevronDown, Coffee, Upload, Search, Loader2 } from "lucide-react";

type MenuItem = {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  cogs: number;
  cogsPercent: number;
  ingredientCount: number;
  ingredients: { product: string; sku: string; qty: number; uom: string; cost: number }[];
};

export default function MenusPage() {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/menus")
      .then((res) => res.json())
      .then((data) => { setMenus(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const categories = ["All", ...new Set(menus.map((m) => m.category).filter(Boolean))];

  const filtered = menus.filter((m) => {
    const matchSearch = m.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === "All" || m.category === catFilter;
    return matchSearch && matchCat;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-terracotta" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Menu & Recipes (BOM)</h2>
          <p className="mt-0.5 text-sm text-gray-500">{menus.length} menu items with ingredient costing</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline"><Upload className="mr-1.5 h-4 w-4" />Import CSV</Button>
          <Button onClick={() => setDialogOpen(true)} className="bg-terracotta hover:bg-terracotta-dark"><Plus className="mr-1.5 h-4 w-4" />Add Menu</Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Search menu items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex gap-1.5">
          {categories.map((c) => (
            <button key={c} onClick={() => setCatFilter(c)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${catFilter === c ? "border-terracotta bg-terracotta/5 text-terracotta-dark" : "border-gray-200 text-gray-500"}`}>{c}</button>
          ))}
        </div>
      </div>

      {/* Menu table with expandable ingredients */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="w-8 px-3 py-3"></th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Menu Item</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Category</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Selling Price</th>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Ingredients</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((menu) => (
              <Fragment key={menu.id}>
                <tr className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => setExpandedId(expandedId === menu.id ? null : menu.id)}>
                  <td className="px-3 py-3">
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expandedId === menu.id ? "rotate-180" : ""}`} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Coffee className="h-4 w-4 text-gray-400" />
                      <p className="font-medium text-gray-900">{menu.name}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3"><Badge variant="outline" className="text-[10px]">{menu.category}</Badge></td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">RM {menu.sellingPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{menu.ingredientCount} items</td>
                  <td className="px-4 py-3 text-right">
                    <button className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"><Pencil className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
                {expandedId === menu.id && (
                  <tr>
                    <td colSpan={6} className="bg-gray-50 px-8 py-3">
                      <p className="mb-2 text-xs font-semibold text-gray-500 uppercase">Recipe / Bill of Materials</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-400">
                            <th className="pb-1 text-left font-medium">Ingredient</th>
                            <th className="pb-1 text-left font-medium">SKU</th>
                            <th className="pb-1 text-right font-medium">Qty</th>
                            <th className="pb-1 text-left font-medium">UOM</th>
                          </tr>
                        </thead>
                        <tbody>
                          {menu.ingredients.map((ing, i) => (
                            <tr key={i} className="border-t border-gray-200/50">
                              <td className="py-1.5 text-gray-700">{ing.product}</td>
                              <td className="py-1.5"><code className="text-gray-500">{ing.sku}</code></td>
                              <td className="py-1.5 text-right text-gray-700">{ing.qty}</td>
                              <td className="py-1.5 text-gray-500">{ing.uom}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Total Menu Items</p>
          <p className="text-xl font-bold text-gray-900">{menus.length}</p>
          <p className="text-xs text-gray-400">{menus.reduce((a, m) => a + m.ingredientCount, 0)} ingredients mapped</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Coffee</p>
          <p className="text-xl font-bold text-gray-900">{menus.filter((m) => m.category === "Coffee").length}</p>
        </Card>
        <Card className="px-4 py-3">
          <p className="text-xs text-gray-500">Food</p>
          <p className="text-xl font-bold text-gray-900">{menus.filter((m) => m.category === "Food").length}</p>
        </Card>
      </div>
    </div>
  );
}
