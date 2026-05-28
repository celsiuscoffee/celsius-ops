import { WrappedView } from "./_WrappedView";

// Wrapped is a full-bleed espresso recap with its own back button —
// no BottomNav, matching apps/pickup-native/app/wrapped.tsx.
export default function WrappedPage() {
  return (
    <main className="text-white" style={{ backgroundColor: "#1A0200" }}>
      <WrappedView />
    </main>
  );
}
