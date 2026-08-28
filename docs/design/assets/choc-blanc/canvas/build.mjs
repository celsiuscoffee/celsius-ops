#!/usr/bin/env node
// Builds the Choc Blanc Merdeka poster canvas.
//
// The three .dc.html artboards in this directory are the source of truth, and
// they carry __PEACHI_BOLD__ / __PEACHI_MED__ placeholders rather than the font
// itself: Peachi already lives in apps/order/src/fonts, so committing ~850 KB of
// base64 alongside it would just be a second copy that can drift. This script
// inlines the real font into a throwaway .build/ copy and seeds the canvas from
// that, which is also what makes the exported PNGs typographically correct —
// webfonts fetched over the network do not survive PNG export.
//
//   node build.mjs --skill-dir /path/to/the/design/skill
//
// The skill directory is where seed-canvas.mjs and payload.template.html live;
// it is extracted per session, so it has to be passed in (or set as
// DESIGN_SKILL_DIR). Output lands in .build/ and is gitignored.

import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../../..");
const build = join(here, ".build");

const argIdx = process.argv.indexOf("--skill-dir");
const skillDir = argIdx !== -1 ? process.argv[argIdx + 1] : process.env.DESIGN_SKILL_DIR;
if (!skillDir) {
  console.error("Need the design skill directory: --skill-dir <path> (or DESIGN_SKILL_DIR).");
  console.error("Run /design in Claude Code to extract it, then pass its base directory.");
  process.exit(1);
}

const ARTBOARDS = ["Main.dc.html", "PosPanel.dc.html", "Splash.dc.html"];
const FONTS = {
  __PEACHI_BOLD__: join(repoRoot, "apps/order/src/fonts/Peachi-Bold.otf"),
  __PEACHI_MED__: join(repoRoot, "apps/order/src/fonts/Peachi-Medium.otf"),
};

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });

const b64 = Object.fromEntries(
  Object.entries(FONTS).map(([token, path]) => [token, readFileSync(path).toString("base64")]),
);

for (const name of ARTBOARDS) {
  let src = readFileSync(join(here, name), "utf8");
  for (const [token, data] of Object.entries(b64)) {
    if (!src.includes(token)) throw new Error(`${name} is missing ${token}`);
    src = src.replaceAll(token, data);
  }
  writeFileSync(join(build, name), src);
}
for (const asset of ["hero.jpg", "canvas.json"]) {
  copyFileSync(join(here, asset), join(build, asset));
}

const out = "choc-blanc-merdeka-posters.html";
const seed = join(skillDir, "seed-canvas.mjs");
const args = [
  seed,
  "--template", join(skillDir, "payload.template.html"),
  "--out", out,
  "--title", "Choc Blanc Merdeka Posters",
  ...ARTBOARDS.flatMap((a) => ["--artboard", a]),
  "--image", "hero.jpg",
  "--canvas", "canvas.json",
];
execFileSync(process.execPath, args, { cwd: build, stdio: "inherit" });
execFileSync(process.execPath, [seed, "--check", out], { cwd: build, stdio: "inherit" });
console.log(`\nbuilt ${join(build, out)}`);
