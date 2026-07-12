// Local test harness for the internal assistant — calls runInternalAssistant
// directly (no WhatsApp/Telegram involved), against the REAL database and the
// REAL Claude API. Read-only by construction (the assistant has no write tools).
// Run: DOTENV_CONFIG_PATH=... npx tsx -r dotenv/config --tsconfig tsconfig.json scripts/assistant-harness.ts
// NOT committed to CI paths — a dev-only script.
import { runInternalAssistant } from "../src/lib/ops-intake/assistant";

const OWNER = { id: "harness", name: "Ammar", role: "OWNER", outletId: null, outletIds: [] as string[] };
const MANAGER_PUTRAJAYA = async () => {
  // Find a real manager so outlet scoping is exercised with real ids.
  const { prisma } = await import("../src/lib/prisma");
  const m = await prisma.user.findFirst({
    where: { role: "MANAGER", status: "ACTIVE", outletId: { not: null } },
    select: { id: true, name: true, outletId: true, outletIds: true, outlet: { select: { name: true } } },
  });
  return m
    ? { reporter: { id: m.id, name: m.name, role: "MANAGER", outletId: m.outletId, outletIds: m.outletIds }, outlet: m.outlet?.name }
    : null;
};

async function ask(label: string, reporter: typeof OWNER, text: string) {
  console.log(`\n${"═".repeat(70)}\n▶ [${label}] ${text}\n${"─".repeat(70)}`);
  const t0 = Date.now();
  const out = await runInternalAssistant({ reporter, text, history: [] });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (out.kind === "reply") console.log(out.text);
  else console.log(`(outcome: ${out.kind})`);
  console.log(`⏱ ${secs}s`);
}

async function main() {
  const single = process.argv.slice(2).join(" ").trim();
  if (single) {
    await ask("OWNER / custom", OWNER, single);
    process.exit(0);
  }
  await ask("OWNER / cash", OWNER, "do we have enough cash for salary this month?");
  await ask(
    "OWNER / analytical (SQL tier)",
    OWNER,
    "which outlet had the best sales this week, and how does that compare to the week before?",
  );
  const mgr = await MANAGER_PUTRAJAYA();
  if (mgr) {
    await ask(`MANAGER(${mgr.outlet}) / scope test`, mgr.reporter as typeof OWNER, "how are sales across all outlets today? and berapa unpaid invoices kita?");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
