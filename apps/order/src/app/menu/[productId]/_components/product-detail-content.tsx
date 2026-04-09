"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Minus, Plus, Check, ShoppingBag } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { useCartStore } from "@/store/cart";
import type { Product, CartModifierSelection } from "@/lib/types";

interface ProductDetailContentProps {
  product: Product;
}

export function ProductDetailContent({ product }: ProductDetailContentProps) {
  const router = useRouter();
  const addItem        = useCartStore((s) => s.addItem);
  const selectedStore  = useCartStore((s) => s.selectedStore);

  const [added, setAdded] = useState(false);

  // Groups hidden from customer view (handled internally / at POS)
  const HIDDEN_GROUPS = new Set(["packaging", "package"]);
  const visibleGroups = product.modifierGroups.filter(
    (g) => !HIDDEN_GROUPS.has(g.name.toLowerCase())
  );

  // selections: groupId → Set of selected optionIds
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const group of visibleGroups) {
      if (!group.multiSelect) {
        // Auto-select the default option (or first if no default)
        const def = group.options.find((o) => o.isDefault) ?? group.options[0];
        if (def) init[group.id] = new Set([def.id]);
      } else {
        init[group.id] = new Set();
      }
    }
    return init;
  });

  const [quantity, setQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState("");

  function toggleOption(groupId: string, optionId: string, multiSelect: boolean) {
    setSelections((prev) => {
      const current = new Set(prev[groupId] ?? []);
      if (multiSelect) {
        if (current.has(optionId)) current.delete(optionId);
        else current.add(optionId);
      } else {
        current.clear();
        current.add(optionId);
      }
      return { ...prev, [groupId]: current };
    });
  }

  // Calculate total price from base + all selected priceDelta
  const priceDelta = visibleGroups.reduce((sum, group) => {
    const selected = selections[group.id] ?? new Set();
    for (const opt of group.options) {
      if (selected.has(opt.id)) sum += opt.priceDelta;
    }
    return sum;
  }, 0);
  const unitPrice = product.basePrice + priceDelta;
  const itemTotal = unitPrice * quantity;

  function handleAddToCart() {
    if (added) return;
    const flat: CartModifierSelection[] = [];
    for (const group of visibleGroups) {
      const selected = selections[group.id] ?? new Set();
      for (const opt of group.options) {
        if (selected.has(opt.id)) {
          flat.push({
            groupId:    group.id,
            groupName:  group.name,
            optionId:   opt.id,
            label:      opt.label,
            priceDelta: opt.priceDelta,
          });
        }
      }
    }
    for (let i = 0; i < quantity; i++) {
      addItem(product, { selections: flat, specialInstructions: specialInstructions.trim() || undefined });
    }

    // Show brief "Added" confirmation, then navigate to menu so the user
    // can continue browsing — regardless of where they entered from.
    setAdded(true);
    setTimeout(() => {
      const menuUrl = selectedStore ? `/menu?store=${selectedStore.id}` : "/menu";
      router.push(menuUrl);
    }, 700);
  }

  return (
    <div className="flex flex-col h-dvh bg-white overflow-hidden">
      {/* Full-screen hero image */}
      <div className="relative h-[52vh] bg-[#160800] shrink-0 overflow-hidden">
        <ProductImage
          src={product.image}
          alt={product.name}
          fill
          sizes="430px"
          fit="cover"
          priority
        />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white/20 to-transparent" />
        <button
          onClick={() => router.back()}
          className="absolute top-12 left-4 bg-black/30 backdrop-blur-sm rounded-full p-2"
        >
          <X className="h-5 w-5 text-white" />
        </button>
        {(product.isPopular || product.isNew) && (
          <div className="absolute top-12 right-4 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">
            {product.isNew ? "New" : "Popular"}
          </div>
        )}
      </div>

      {/* White sheet */}
      <div className="flex-1 bg-white rounded-t-3xl -mt-6 relative z-10 overflow-y-auto pb-36">
        <div className="px-5 pt-5 pb-2">
          <h1 className="text-3xl font-black font-display text-[#160800]">{product.name}</h1>
          {product.description && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {product.description}
            </p>
          )}
          <p className="text-2xl font-black text-primary mt-2.5">
            RM {unitPrice.toFixed(2)}
          </p>
        </div>

        {visibleGroups.length > 0 && (
          <div className="h-px bg-border mx-5 my-3" />
        )}

        <div className="px-5 space-y-6">
          {visibleGroups.map((group) => (
            <section key={group.id}>
              <h3 className="uppercase tracking-wider text-xs font-semibold text-muted-foreground mb-3">
                {group.name}
              </h3>

              {group.multiSelect ? (
                // Checkboxes for add-ons
                <div className="space-y-2">
                  {group.options.map((opt) => {
                    const isSelected = selections[group.id]?.has(opt.id) ?? false;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(group.id, opt.id, true)}
                        className={`w-full flex items-center justify-between p-3.5 rounded-xl border transition-all ${
                          isSelected ? "bg-primary/5 border-primary/30" : "border-border bg-white"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? "bg-primary border-primary" : "border-border"
                          }`}>
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="text-sm font-medium">{opt.label}</span>
                        </div>
                        {opt.priceDelta > 0 && (
                          <span className={`text-sm ${isSelected ? "text-primary font-medium" : "text-muted-foreground"}`}>
                            +RM {opt.priceDelta.toFixed(2)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                // Pills for single-select (Temperature, Packaging, etc.)
                <div className="flex flex-wrap gap-2">
                  {group.options.map((opt) => {
                    const isSelected = selections[group.id]?.has(opt.id) ?? false;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => toggleOption(group.id, opt.id, false)}
                        className={`flex-1 min-w-[80px] py-3 px-4 rounded-xl border text-sm font-medium transition-all flex flex-col items-center gap-0.5 ${
                          isSelected
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-foreground"
                        }`}
                      >
                        <span className="flex items-center gap-1">
                          {isSelected && <Check className="h-3.5 w-3.5" />}
                          {opt.label}
                        </span>
                        {opt.priceDelta > 0 && (
                          <span className={`text-xs ${isSelected ? "text-primary/70" : "text-muted-foreground"}`}>
                            +RM {opt.priceDelta.toFixed(2)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>

        {/* Special instructions */}
        <div className="px-5 pt-2 pb-4">
          <div className="h-px bg-border mb-5" />
          <h3 className="uppercase tracking-wider text-xs font-semibold text-muted-foreground mb-3">
            Special Instructions
          </h3>
          <textarea
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            placeholder="e.g. Extra hot, no ice, allergy to nuts…"
            maxLength={200}
            rows={3}
            className="w-full rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm resize-none outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 placeholder:text-muted-foreground/50 transition-all"
          />
          <p className="text-right text-[10px] text-muted-foreground mt-1">{specialInstructions.length}/200</p>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 inset-x-0 max-w-[430px] mx-auto bg-white border-t px-5 py-4 z-20">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-9 h-9 rounded-full border-2 border-border flex items-center justify-center"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="text-base font-bold w-5 text-center">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-9 h-9 rounded-full bg-primary flex items-center justify-center"
            >
              <Plus className="h-3.5 w-3.5 text-primary-foreground" />
            </button>
          </div>

          <button
            onClick={handleAddToCart}
            disabled={!product.isAvailable || added}
            className={`flex-1 rounded-full py-4 font-semibold text-[15px] transition-colors flex items-center justify-center gap-2
              ${added
                ? "bg-emerald-600 text-white"
                : "bg-[#160800] text-white disabled:opacity-50"
              }`}
          >
            {added ? (
              <>
                <Check className="h-4 w-4" />
                Added to Cart
              </>
            ) : product.isAvailable ? (
              <>
                <ShoppingBag className="h-4 w-4" />
                {`Add to Cart — RM ${itemTotal.toFixed(2)}`}
              </>
            ) : (
              "Unavailable"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
