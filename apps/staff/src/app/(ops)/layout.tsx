import { BottomNav } from "@/components/bottom-nav";
import { RouteAccessGuard } from "@/components/route-access-guard";
import { SessionWatchdog } from "@/components/session-watchdog";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto h-full max-w-lg">
      <SessionWatchdog />
      <main className="pb-24">
        <RouteAccessGuard>{children}</RouteAccessGuard>
      </main>
      <BottomNav />
    </div>
  );
}
