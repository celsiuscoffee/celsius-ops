import { OrdersView } from "./_OrdersView";
import { BottomNav } from "../_BottomNav";

export default function OrdersPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <OrdersView />
      <BottomNav active="orders" />
    </main>
  );
}
