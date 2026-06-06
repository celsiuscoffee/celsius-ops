// One-off backfill: parse every Maybank PDF in the local folder and persist it
// (idempotently) into BankStatement + BankStatementLine on the live DB.
//
//   node --import tsx apps/backoffice/scripts/maybank-backfill.ts ["<folder>"]
//
// Loads apps/backoffice/.env.local for DATABASE_URL, then uses the @celsius/db
// Prisma singleton + the shared persist layer (same code path as the ingest API).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const ROOT = process.argv[2] ?? "/Users/ammarshahrin/Desktop/Celsius/Maybank Bank Statement";
const UPLOADER = "213c5fb5-06ab-47c5-aa5f-a737dadaedf8"; // admin user (hanismsalleh+1)
const ACCOUNTS = ["2644", "4384", "9345"];

async function main() {
  const { prisma } = await import("@celsius/db");
  const { parseMaybankStatementText } = await import("../src/lib/finance/maybank-statement-parser");
  const { persistMaybankStatement } = await import("../src/lib/finance/persist-bank-statement");

  let files = 0;
  let reconciled = 0;
  let lines = 0;
  for (const acc of ACCOUNTS) {
    const dir = join(ROOT, acc);
    for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".pdf")).sort()) {
      files++;
      try {
        const m = f.match(/_(\d{12})_(\d{4}-\d{2}-\d{2})\.pdf$/i);
        const text = execFileSync("pdftotext", ["-layout", join(dir, f), "-"], {
          encoding: "utf8",
          maxBuffer: 128 * 1024 * 1024,
        });
        const parsed = parseMaybankStatementText(text, { accountNumber: m?.[1], statementDate: m?.[2] });
        const r = await persistMaybankStatement(prisma, parsed, { uploadedById: UPLOADER, sourceFileName: f });
        lines += r.linesCreated;
        if (r.reconciled) reconciled++;
        console.log(
          `${r.reconciled ? "OK " : "BAD"} ${r.created ? "new " : "repl"} ${r.accountName} ${r.statementDate} ` +
            `lines=${String(r.linesCreated).padStart(4)} in=${String(r.totalInflows).padStart(11)} out=${String(r.totalOutflows).padStart(11)} ` +
            `interco=${r.interCoInflows}/${r.interCoOutflows} close=${r.closingBalance}`
        );
      } catch (e) {
        console.log(`ERR ${acc}/${f}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  console.log(`\n${reconciled}/${files} reconciled · ${lines} lines persisted`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
