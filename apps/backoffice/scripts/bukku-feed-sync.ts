// CLI wrapper over the production sync lib (src/lib/finance/bukku-feed-sync).
// Same code path as the daily cron — use this for the one-time catch-up.
//   pnpm tsx --env-file=.env.local scripts/bukku-feed-sync.ts            # dry-run
//   pnpm tsx --env-file=.env.local scripts/bukku-feed-sync.ts --commit   # write

import { syncBukkuFeedLedger } from "../src/lib/finance/bukku-feed-sync";

const fmt = (n: number | null) => (n == null ? "—" : `RM ${n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(commit ? "COMMIT MODE — writing" : "DRY-RUN — no writes");
  const { accounts } = await syncBukkuFeedLedger({ commit });
  for (const a of accounts) {
    console.log(`\n=== ${a.subdomain} (…${a.accountTail}) ===`);
    if (a.skipped) { console.log(`  skipped: ${a.skipped}`); continue; }
    console.log(`  anchor ${fmt(a.anchorBalance)} @ ${a.anchorDate}`);
    console.log(`  ${a.newLines} new lines → ${a.statements} statement(s), latest ${a.latestDate}, ending ${fmt(a.endingBalance)}${a.committed ? "  ✓ committed" : ""}`);
  }
  console.log(commit ? "\nDone." : "\n(dry-run — add --commit to write)\n");
}
main().then(() => process.exit(0)).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
