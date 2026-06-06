// Server-side (serverless-safe) PDF text extraction for the in-app upload path.
// The local watcher uses `pdftotext -layout`; this reproduces that row-major
// layout from pdfjs (via unpdf) by grouping text items into rows by their
// y-coordinate and sorting each row left-to-right. The output is fed to the
// same parseMaybankStatementText() as the watcher path.

import { getDocumentProxy } from "unpdf";

type TextItem = { str: string; transform: number[] };

export async function extractMaybankText(data: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(data);
  const lines: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as TextItem[]).filter((it) => typeof it.str === "string" && it.str.trim() !== "");

    // Bucket items into rows by y (pdfjs y grows upward). Tolerate ~2px jitter.
    const rows: { y: number; items: TextItem[] }[] = [];
    for (const it of items) {
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push(it);
    }

    rows.sort((a, b) => b.y - a.y); // top to bottom
    for (const row of rows) {
      const line = row.items
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) lines.push(line);
    }
  }

  return lines.join("\n");
}
