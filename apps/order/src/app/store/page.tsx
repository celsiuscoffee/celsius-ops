"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, Clock, Users, CheckCircle2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCartStore } from "@/store/cart";
import type { Store } from "@/lib/types";
import { BottomNav } from "@/components/bottom-nav";

export default function StoreSelector() {
  const router = useRouter();
  const { selectedStore, setSelectedStore } = useCartStore();
  const itemCount = useCartStore((s) => s.getItemCount());
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stores")
      .then((r) => r.json())
      .then((data: Store[]) => {
        setStores(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleSelectStore(store: Store) {
    setSelectedStore(store);
    // If they already have items, skip the menu and review the cart at the
    // freshly-chosen outlet instead of starting a new browse session.
    router.push(itemCount > 0 ? "/cart" : `/menu?store=${store.id}`);
  }

  return (
    <div className="flex flex-col min-h-dvh bg-[#f5f5f5]">
      {/* Header */}
      <header className="bg-[#160800] text-white px-4 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-bold">Select Pickup Outlet</h1>
        </div>
      </header>

      {/* Map Placeholder */}
      <div className="bg-muted h-48 flex items-center justify-center relative">
        <div className="text-center text-muted-foreground">
          <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Map view</p>
          <p className="text-xs">3 outlets nearby</p>
        </div>
        {/* Store pins */}
        <div className="absolute top-8 left-1/4 bg-primary text-primary-foreground rounded-full p-1.5 shadow-lg">
          <MapPin className="h-4 w-4" />
        </div>
        <div className="absolute top-16 right-1/3 bg-primary text-primary-foreground rounded-full p-1.5 shadow-lg">
          <MapPin className="h-4 w-4" />
        </div>
        <div className="absolute bottom-10 left-1/2 bg-primary text-primary-foreground rounded-full p-1.5 shadow-lg">
          <MapPin className="h-4 w-4" />
        </div>
      </div>

      {/* Store List */}
      <main className="flex-1 px-4 py-4 space-y-3 pb-20">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-0.5">
          Outlets near you
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          stores.map((store) => {
            const isSelected = selectedStore?.id === store.id;
            return (
              <Card
                key={store.id}
                className={`p-4 cursor-pointer transition-all shadow-sm ${
                  isSelected
                    ? "ring-2 ring-[#160800] border-[#160800] bg-white shadow-md"
                    : "border border-border/60 bg-white hover:border-primary/30 hover:shadow-md"
                }`}
                onClick={() => handleSelectStore(store)}
              >
                <div className="flex items-start gap-3.5">
                  <div className={`rounded-xl p-2.5 mt-0.5 shrink-0 ${isSelected ? "bg-primary/15" : "bg-primary/8"}`}>
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-[15px]">{store.name}</h3>
                      {store.isBusy && (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 border-amber-300 text-amber-700 bg-amber-50"
                          >
                            <Users className="h-3 w-3 mr-0.5" />
                            Busy
                          </Badge>
                        </span>
                      )}
                      {!store.isOpen && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Closed
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {store.address}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {store.pickupTime}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {store.id === "shah-alam" ? "3.2 km" : store.id === "conezion" ? "5.8 km" : "4.1 km"}
                      </span>
                    </div>
                  </div>
                  {isSelected ? (
                    <CheckCircle2 className="h-5 w-5 text-[#160800] shrink-0 mt-0.5" />
                  ) : (
                    <Button
                      size="sm"
                      variant={store.isOpen ? "default" : "secondary"}
                      disabled={!store.isOpen}
                      className="rounded-full text-xs shrink-0"
                    >
                      Select
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </main>

      <BottomNav />
    </div>
  );
}
