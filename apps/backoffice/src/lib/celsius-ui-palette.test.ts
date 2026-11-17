import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Celsius UI step 6 (17 Nov 2026): pages use the Celsius UI tokens (text-text,
// bg-surface, border-line, bg-ink…), which follow light and dark mode, instead
// of the old fixed palette. This keeps the old light-mode classes from coming
// back. Signals (red, amber, green, blue) and dark: overrides are not checked.

const ROOTS = ["app/(admin)", "components"];
const SKIP = /components[\\/]ui[\\/]/;
const LEGACY = /(?<![\w:\-[])(?:hover:|focus:|active:|group-hover:|md:|sm:|lg:)*(?:(?:text|bg|border|divide)-(?:gray|neutral|slate|zinc|stone)-(?:50|100|200|300|400|500|600|700|800|900)(?![\w-])|bg-white(?![\w-])|(?:text|bg|border|ring)-terracotta(?:-dark|-light)?(?![\w-])|(?:text|bg|border)-\[#(?:160800|C2452D|A33822)\])/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("Celsius UI palette", () => {
  it("no page uses the old fixed light-mode colours", () => {
    const base = join(__dirname, "..");
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const f of files(join(base, root))) {
        if (SKIP.test(f)) continue;
        const src = readFileSync(f, "utf8");
        for (const m of src.matchAll(LEGACY)) {
          // dark-only overrides are allowed (globals.css warms them)
          const before = src.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
          if (/dark:[\w:-]*$/.test(before)) continue;
          // shades used as solid fills (avatars, bars) above 300 stay allowed for bg
          if (/^(?:[\w-]+:)*bg-(?:gray|neutral|slate|zinc|stone)-[4-9]00$/.test(m[0])) continue;
          if (/^(?:[\w-]+:)*border-(?:gray|neutral|slate|zinc|stone)-[5-9]00$/.test(m[0])) continue;
          hits.push(`${f.slice(base.length + 1)}: ${m[0]}`);
        }
      }
    }
    expect(hits.slice(0, 20), `${hits.length} old palette classes`).toEqual([]);
  });
});
