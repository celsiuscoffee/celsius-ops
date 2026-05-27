import { RewardsView } from "./_RewardsView";
import { BottomNav } from "../_BottomNav";

export default function RewardsPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <RewardsView />
      <BottomNav active="rewards" />
    </main>
  );
}
