/* eslint-disable @typescript-eslint/no-require-imports */
// Walks every BankStatementLine and re-runs the classifier against the
// current rule set. Updates category, isInterCo, ruleName in place.
// Use after changing classifier rules.

import { PrismaClient } from "@prisma/client";
import { classifyBankLine } from "../src/lib/finance/bank-line-classifier";

const prisma = new PrismaClient();

async function main() {
  const lines = await prisma.bankStatementLine.findMany({
    select: {
      id: true, description: true, reference: true, amount: true,
      direction: true, category: true, isInterCo: true, ruleName: true,
      outletId: true,
    },
  });

  // outlet code → id
  const outlets = await prisma.outlet.findMany({ select: { id: true, code: true } });
  const codeToId = new Map(outlets.map((o) => [o.code, o.id]));

  let changedCategory = 0;
  let changedInterCo = 0;
  let unchanged = 0;

  // Batch updates in chunks via transactions for throughput
  const BATCH = 100;
  for (let i = 0; i < lines.length; i += BATCH) {
    const chunk = lines.slice(i, i + BATCH);
    await prisma.$transaction(
      chunk.map((l) => {
        const cls = classifyBankLine({
          description: l.description,
          reference: l.reference,
          amount: Number(l.amount),
          direction: l.direction as "CR" | "DR",
        });
        const newOutletId = cls.outletCode ? codeToId.get(cls.outletCode) ?? null : null;
        const catChanged = cls.category !== l.category;
        const icoChanged = cls.isInterCo !== l.isInterCo;
        if (!catChanged && !icoChanged && cls.ruleName === l.ruleName) {
          unchanged++;
          return prisma.bankStatementLine.findUnique({ where: { id: l.id }, select: { id: true } });
        }
        if (catChanged) changedCategory++;
        if (icoChanged) changedInterCo++;
        return prisma.bankStatementLine.update({
          where: { id: l.id },
          data: {
            category: cls.category,
            isInterCo: cls.isInterCo,
            ruleName: cls.ruleName,
            // Don't override manually-set outletIds (when classifiedBy='manual')
            outletId: l.outletId ?? newOutletId,
          },
        });
      }),
    );
    if ((i / BATCH) % 5 === 0) {
      process.stdout.write(`  ${i + chunk.length}/${lines.length}...\r`);
    }
  }
  console.log(`\nProcessed ${lines.length} lines`);
  console.log(`  category changed: ${changedCategory}`);
  console.log(`  isInterCo changed: ${changedInterCo}`);
  console.log(`  unchanged: ${unchanged}`);

  // Summary by category
  const summary = await prisma.bankStatementLine.groupBy({
    by: ["category", "direction"],
    _count: { _all: true },
    _sum: { amount: true },
  });
  console.log("\n--- Category summary ---");
  for (const s of summary.sort((a, b) => (a.category ?? "").localeCompare(b.category ?? ""))) {
    const dir = s.direction === "CR" ? "in " : "out";
    const amt = Number(s._sum.amount ?? 0);
    console.log(`  ${dir} ${(s.category ?? "—").padEnd(28)} ${String(s._count._all).padStart(5)}  RM ${amt.toFixed(2)}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
