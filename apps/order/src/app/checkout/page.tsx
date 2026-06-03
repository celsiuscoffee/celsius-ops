import { CheckoutView } from "./_CheckoutView";

export default function CheckoutPage() {
  return (
    // No bottom tab bar on checkout — matches native, where sub-screens opt
    // out of the Home/Rewards/Menu/Orders/Account bar. Back via the header arrow.
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <CheckoutView />
    </main>
  );
}
