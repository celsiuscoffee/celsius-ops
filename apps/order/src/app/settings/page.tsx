import { SettingsView } from "./_SettingsView";
import { BottomNav } from "../_BottomNav";

export default function SettingsPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+88px)]">
      <SettingsView />
      <BottomNav active="account" />
    </main>
  );
}
