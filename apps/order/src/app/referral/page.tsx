import { ReferralView } from "./_ReferralView";
import { BottomNav } from "../_BottomNav";

export default function ReferralPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <ReferralView />
      <BottomNav active="rewards" />
    </main>
  );
}
