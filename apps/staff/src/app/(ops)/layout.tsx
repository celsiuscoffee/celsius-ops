import { BottomNav } from "@/components/bottom-nav";
import { RouteAccessGuard } from "@/components/route-access-guard";
import { SessionWatchdog } from "@/components/session-watchdog";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto h-full max-w-lg">
      <SessionWatchdog />
      <main className="pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        <RouteAccessGuard>{children}</RouteAccessGuard>
      </main>
      <BottomNav />
    </div>
  );
}
