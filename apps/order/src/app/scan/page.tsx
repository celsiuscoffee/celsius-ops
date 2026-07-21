import { ScanWall } from "./_ScanWall";

/**
 * /scan — the dine-in gate. Shown to anyone who reaches the ordering flow
 * without a scanned table (see _ScanWall). No bottom tab bar; the wall owns
 * the whole viewport.
 */
export default function ScanPage() {
  return (
    <main className="bg-white text-[#160800] min-h-screen">
      <ScanWall />
    </main>
  );
}
