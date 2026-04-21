import { BottomNav } from "@/components/bottom-nav";
import { RouteAccessGuard } from "@/components/route-access-guard";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto h-full max-w-lg">
      <main className="pb-24">
        <RouteAccessGuard>{children}</RouteAccessGuard>
      </main>
      <BottomNav />
    </div>
  );
}
