import { ReferralView } from "./_ReferralView";

export default function ReferralPage() {
  return (
    // No bottom tab bar — matches native (sub-screens opt out). Back via header.
    <main className="bg-white text-[#160800] min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
      <ReferralView />
    </main>
  );
}
