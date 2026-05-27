import { WrappedView } from "./_WrappedView";
import { BottomNav } from "../_BottomNav";

export default function WrappedPage() {
  return (
    <main className="bg-[#160800] text-white min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <WrappedView />
      <BottomNav active="rewards" />
    </main>
  );
}
