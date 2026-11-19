import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { colorNames, palette } from "./tokens";

// The manager app on Celsius UI (19 Nov 2026). Three things keep it there:
// 1. its tokens are the back office's (same names, same values, light and dark);
// 2. every Tailwind colour class reads those tokens;
// 3. no screen goes back to the old fixed palette or a hard-coded colour.

const APP = join(__dirname, "..", "..");
const BACKOFFICE_TOKENS = join(APP, "..", "backoffice", "src", "styles", "celsius-ui", "tokens.css");

function cssBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

describe("Celsius UI tokens (manager app)", () => {
  const css = readFileSync(BACKOFFICE_TOKENS, "utf8");
  const light = cssBlock(css, ":root");
  const dark = { ...light, ...cssBlock(css, ".dark") };

  it("match the back office tokens in light and dark", () => {
    const drift: string[] = [];
    for (const n of colorNames) {
      if (norm(palette.light[n]) !== norm(light[n] ?? "")) drift.push(`light ${n}: ${palette.light[n]} ≠ ${light[n]}`);
      if (norm(palette.dark[n]) !== norm(dark[n] ?? "")) drift.push(`dark ${n}: ${palette.dark[n]} ≠ ${dark[n]}`);
    }
    expect(drift).toEqual([]);
  });

  it("every Tailwind colour reads its token", () => {
    const tw = readFileSync(join(APP, "tailwind.config.js"), "utf8");
    const missing = colorNames.filter(
      (n) => !tw.includes(`"${n}": "var(--${n}, ${palette.light[n]})"`),
    );
    expect(missing).toEqual([]);
  });
});

// Old palette classes (before 19 Nov 2026) and hard-coded colours.
const LEGACY_CLASS =
  /(?<![\w-])(?:[a-z]+:)*(?:(?:text|bg|border)-(?:espresso|background|primary(?:-\d+)?|muted(?:-fg)?|success|amber-\d+|gray-\d+|blue-\d+|red-\d+|emerald-\d+|purple-\d+|indigo-\d+|warning)(?:\/\d+)?|border-border|(?:text|bg|border)-\[#[0-9A-Fa-f]+\])(?![\w-])/g;
const HEX = /["'`]#[0-9A-Fa-f]{3,8}["'`]/g;
// Camera overlays sit on a live photo, so they keep white and black.
const CAMERA = /(SelfieCapture|ReceiptCapture)\.tsx$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("Manager app screens", () => {
  const all = [...files(join(APP, "app")), ...files(join(APP, "components"))];

  it("use no old palette class", () => {
    const hits: string[] = [];
    for (const f of all) {
      for (const m of readFileSync(f, "utf8").matchAll(LEGACY_CLASS)) hits.push(`${f.slice(APP.length + 1)}: ${m[0]}`);
    }
    expect(hits.slice(0, 20), `${hits.length} old palette classes`).toEqual([]);
  });

  it("hard-code no colour (useCelsius().color instead)", () => {
    const hits: string[] = [];
    for (const f of all) {
      if (CAMERA.test(f)) continue;
      for (const m of readFileSync(f, "utf8").matchAll(HEX)) hits.push(`${f.slice(APP.length + 1)}: ${m[0]}`);
    }
    expect(hits.slice(0, 20), `${hits.length} hex colours`).toEqual([]);
  });

  it("keep five tabs at most", () => {
    const layout = readFileSync(join(APP, "app", "(staff)", "_layout.tsx"), "utf8");
    const titles = new Set([...layout.matchAll(/title: "([^"]+)",\s+icon:/g)].map((m) => m[1]));
    expect(titles.size).toBeLessThanOrEqual(5);
  });
});
