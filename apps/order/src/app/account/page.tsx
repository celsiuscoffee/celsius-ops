import { AccountView } from "./_AccountView";
import { BottomNav } from "../_BottomNav";

export default function AccountPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <AccountView />
      <BottomNav active="account" />
    </main>
  );
}
