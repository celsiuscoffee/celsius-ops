// Verifies the server-side (unpdf) extraction path reconciles, by comparing it
// to the parser on one real PDF. Run: npx tsx apps/backoffice/scripts/maybank-extract-check.ts
import { readFileSync } from "node:fs";

async function main() {
  const { extractMaybankText } = await import("../src/lib/finance/maybank-pdf-extract");
  const { parseMaybankStatementText } = await import("../src/lib/finance/maybank-statement-parser");

  const files = [
    "/Users/ammarshahrin/Desktop/Celsius/Maybank Bank Statement/9345/MBBcurrent_562263659345_2026-05-31.pdf",
    "/Users/ammarshahrin/Desktop/Celsius/Maybank Bank Statement/4384/MBBcurrent_562263574384_2026-04-30.pdf",
  ];
  for (const f of files) {
    const data = new Uint8Array(readFileSync(f));
    const text = await extractMaybankText(data);
    const r = parseMaybankStatementText(text, { statementDate: f.match(/(\d{4}-\d{2}-\d{2})/)?.[1] });
    console.log(
      `${r.reconciled ? "OK " : "BAD"} ${f.split("/").pop()} rows=${r.rowsParsed} ` +
        `beg=${r.beginningBalance} end=${r.endingBalance} in=${r.totalInflows} out=${r.totalOutflows}` +
        (r.warnings.length ? `  WARN: ${r.warnings[0]}` : "")
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
