import { BottomNav } from "@/components/bottom-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto h-full max-w-lg">
      <main className="pb-24">{children}</main>
      <BottomNav />
    </div>
  );
}
