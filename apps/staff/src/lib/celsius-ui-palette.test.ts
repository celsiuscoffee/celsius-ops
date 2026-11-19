import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Celsius UI in the Staff app (19 Nov 2026, docs/design/staff-app-structure.md):
// pages use the Celsius UI tokens (text-text, bg-surface, border-line, bg-ink,
// the ok/warn/danger/info signals…), which follow the phone's light and dark
// mode, instead of the old fixed palette. This keeps the old classes from
// coming back. Stricter than the back office's test: the signal colours moved
// too, because the Staff app has no dark-mode overrides for fixed colours.
// bg-black/NN stays allowed (a scrim over photos and the camera).

const ROOTS = ["app", "components"];
const SKIP = /components[\\/]ui[\\/]|[\\/]api[\\/]/;
const FAMILIES = "gray|neutral|slate|zinc|stone|red|rose|pink|green|emerald|lime|teal|amber|yellow|orange|blue|sky|indigo|cyan|purple|violet|fuchsia";
const LEGACY = new RegExp(
  String.raw`(?<![\w\-[])(?:[\w-]+:)*(?:` +
    String.raw`(?:text|bg|border(?:-[lrtbxy])?|ring|divide|from|to|via|fill|stroke|placeholder|outline)-(?:${FAMILIES})-\d{2,3}(?![\w-])` +
    String.raw`|bg-white(?![\w-])|text-black(?![\w-])` +
    String.raw`|(?:text|bg|border|ring|from|to)-(?:terracotta|brand-dark|brand-offwhite)(?:-dark|-light)?(?![\w-])` +
    String.raw`|(?:text|bg|border|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]` +
  ")",
  "g",
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("Celsius UI palette (Staff app)", () => {
  it("no page uses the old fixed colours", () => {
    const base = join(__dirname, "..");
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const f of files(join(base, root))) {
        if (SKIP.test(f)) continue;
        const src = readFileSync(f, "utf8");
        for (const m of src.matchAll(LEGACY)) hits.push(`${f.slice(base.length + 1)}: ${m[0]}`);
      }
    }
    expect(hits.slice(0, 20), `${hits.length} old palette classes`).toEqual([]);
  });

  it("globals.css reads the shared Celsius UI tokens", () => {
    const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
    expect(css).toContain('@import "../styles/celsius-ui/tokens.css"');
  });

  it("the tokens file is the back office's, unchanged", () => {
    const mine = readFileSync(join(__dirname, "..", "styles", "celsius-ui", "tokens.css"), "utf8");
    const office = readFileSync(join(__dirname, "..", "..", "..", "backoffice", "src", "styles", "celsius-ui", "tokens.css"), "utf8");
    expect(mine).toBe(office);
  });
});
