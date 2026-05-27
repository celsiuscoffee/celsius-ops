import { CartView } from "./_CartView";
import { BottomNav } from "../_BottomNav";

/**
 * Cart screen. Cart state lives in localStorage (the SPA's persisted
 * Zustand store), so the contents have to render client-side — see
 * _CartView. This page is just the route shell + chrome.
 */
export default function CartPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <CartView />
      <BottomNav active="home" />
    </main>
  );
}
