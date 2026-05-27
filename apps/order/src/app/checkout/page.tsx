import { CheckoutView } from "./_CheckoutView";
import { BottomNav } from "../_BottomNav";

export default function CheckoutPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <CheckoutView />
      <BottomNav active="home" />
    </main>
  );
}
