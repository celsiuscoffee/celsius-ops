"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Coffee, Minus, Plus, Trash2, MapPin, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ProductImage } from "@/components/product-image";
import { useCartStore } from "@/store/cart";
import { BottomNav } from "@/components/bottom-nav";

export default function CartPage() {
  const router = useRouter();
  const items = useCartStore((s) => s.items);
  const selectedStore = useCartStore((s) => s.selectedStore);
  const total = useCartStore((s) => s.getTotal());
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);

  const finalTotal = total;

  if (items.length === 0) {
    return (
      <div className="flex flex-col min-h-dvh">
        <header className="bg-[#160800] text-white px-4 pt-12 pb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()} className="p-1">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-bold">Your Cart</h1>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center px-4 text-center">
          <Coffee className="h-16 w-16 text-muted-foreground/30 mb-4" />
          <h2 className="font-bold text-lg">Your cart is empty</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-6">
            Add some drinks to get started
          </p>
          <Button nativeButton={false} render={<Link href={selectedStore ? `/menu?store=${selectedStore.id}` : "/store"} />} className="rounded-full">
            Browse Menu
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Your Cart</h1>
          <span className="text-sm opacity-70">({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
        </div>
      </header>

      <main className="flex-1 px-4 py-4 space-y-4 pb-56">
        {/* Pickup Info */}
        {selectedStore && (
          <Card className="p-3.5 border border-border/60 shadow-sm bg-white">
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="h-4 w-4 text-primary shrink-0" />
              <span className="font-semibold">{selectedStore.name}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1 ml-6">
              <Clock className="h-3 w-3" />
              <span>Pickup {selectedStore.pickupTime}</span>
            </div>
          </Card>
        )}

        {/* Cart Items */}
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="p-3.5 border border-border/60 shadow-sm bg-white">
              <div className="flex gap-3.5">
                <div className="w-16 h-16 bg-muted rounded-2xl shrink-0 overflow-hidden relative">
                  <ProductImage
                    src={item.product.image}
                    alt={item.product.name}
                    fill
                    sizes="64px"
                    thumbnailWidth={64}
                    fit="contain"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="font-semibold text-[15px] leading-snug">{item.product.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {item.modifiers.selections.map((s) => s.label).join(" · ")}
                      </p>
                    </div>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-muted-foreground hover:text-destructive p-1 shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-7 h-7 rounded-full border border-border flex items-center justify-center bg-white hover:bg-muted transition-colors"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm font-bold w-6 text-center">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-7 h-7 rounded-full bg-primary flex items-center justify-center"
                      >
                        <Plus className="h-3 w-3 text-primary-foreground" />
                      </button>
                    </div>
                    <p className="font-bold text-[15px] text-[#160800]">
                      RM {item.totalPrice.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Order Summary */}
        <Card className="p-4 space-y-3 border border-border/60 shadow-sm bg-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Order Summary</p>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">RM {total.toFixed(2)}</span>
          </div>
          <Separator />
          <div className="flex justify-between font-black text-base">
            <span>Total</span>
            <span className="text-[#160800]">RM {finalTotal.toFixed(2)}</span>
          </div>
        </Card>
      </main>

      {/* Checkout Button — sits above bottom nav */}
      <div className="fixed bottom-[72px] left-1/2 -translate-x-1/2 w-full max-w-[430px] px-4 z-10 space-y-2">
        {/* Pickup-only notice */}
        <div className="flex items-center justify-center gap-1.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5">
          <MapPin className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <p className="text-xs font-medium text-amber-700">
            Self-pickup only · No delivery available
          </p>
        </div>
        <Button
          className="w-full rounded-full font-bold text-base py-7 shadow-xl bg-[#160800] hover:bg-[#2a1200] text-white"
          size="lg"
          nativeButton={false} render={<Link href="/checkout" />}
        >
          Checkout — RM {finalTotal.toFixed(2)}
        </Button>
      </div>

      <BottomNav />
    </div>
  );
}
