// One-off: parse every real Maybank PDF in the local folder and report whether
// it reconciles against its own running-balance column. Run: npx tsx <thisfile>
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseMaybankStatementText } from "../src/lib/finance/maybank-statement-parser";

const ROOT = process.argv[2] ?? "/Users/ammarshahrin/Desktop/Celsius/Maybank Bank Statement";
const accounts = ["2644", "4384", "9345"];
let ok = 0;
let total = 0;

for (const acc of accounts) {
  const dir = join(ROOT, acc);
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  for (const f of pdfs) {
    total++;
    const m = f.match(/_(\d{12})_(\d{4}-\d{2}-\d{2})\.pdf$/i);
    const text = execFileSync("pdftotext", ["-layout", join(dir, f), "-"], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
    const r = parseMaybankStatementText(text, { accountNumber: m?.[1], statementDate: m?.[2] });
    if (r.reconciled) ok++;
    const tag = r.reconciled ? "OK " : "BAD";
    const date = f.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "?";
    console.log(
      `${tag} ${acc} ${date} rows=${String(r.rowsParsed).padStart(4)} ` +
        `beg=${String(r.beginningBalance).padStart(12)} end=${String(r.endingBalance).padStart(12)} ` +
        `in=${String(r.totalInflows).padStart(12)} out=${String(r.totalOutflows).padStart(12)}` +
        (r.warnings.length ? `  WARN: ${r.warnings[0]}` : "")
    );
  }
}
console.log(`\n${ok}/${total} statements reconciled`);
