#!/usr/bin/env node
// Renders the three artboards to upload-ready PNG + JPEG.
//
// Run build.mjs first — this renders the .build/ copies, which are the ones
// with Peachi inlined. Rendering the committed sources instead would silently
// produce fallback-font posters.
//
//   node build.mjs --skill-dir <design skill dir> && node render-posters.mjs
//
// Output lands in .build/out/ (gitignored).
//
// Two gotchas this encodes, both of which produce a plausible-looking but
// wrong poster if you get them wrong:
//
//  1. --window-size counts browser chrome, so the LAYOUT VIEWPORT is ~87px
//     shorter than the number you pass. The artboard then lays out short and
//     the remainder is painted with the page background — the poster looks
//     fine until you notice the last line of copy is missing. So render with
//     headroom and crop to the artboard's declared box from the top-left.
//  2. Fonts must be embedded, not fetched. A webfont over the network does not
//     survive this render (nor the canvas's own PNG export).

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, ".build");
const out = join(build, "out");

const ARTBOARDS = [
  { file: "Main.dc.html", w: 1200, h: 1121, name: "choc-blanc-home" },
  { file: "Splash.dc.html", w: 1080, h: 2340, name: "choc-blanc-splash" },
  { file: "PosPanel.dc.html", w: 920, h: 1200, name: "choc-blanc-pos" },
  { file: "IgFeed.dc.html", w: 1080, h: 1350, name: "choc-blanc-ig-feed" },
  { file: "IgStory.dc.html", w: 1080, h: 1920, name: "choc-blanc-ig-story" },
  { file: "IgSquare.dc.html", w: 1080, h: 1080, name: "choc-blanc-ig-square" },
];

const CHROME =
  process.env.CHROME_PATH ??
  (() => {
    const root = "/opt/pw-browsers";
    const dir = readdirSync(root).find((d) => d.startsWith("chromium-"));
    if (!dir) throw new Error("No Chromium under /opt/pw-browsers; set CHROME_PATH.");
    return join(root, dir, "chrome-linux", "chrome");
  })();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const HEADROOM_W = 200;
const HEADROOM_H = 300; // must exceed the browser-chrome inset (see gotcha 1)

for (const { file, w, h, name } of ARTBOARDS) {
  const raw = join(out, `raw-${name}.png`);
  execFileSync(
    CHROME,
    [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${w + HEADROOM_W},${h + HEADROOM_H}`,
      "--virtual-time-budget=8000",
      `--screenshot=${raw}`,
      `file://${join(build, file)}`,
    ],
    { stdio: "ignore" },
  );
  renameSync(raw, join(out, `${name}-raw.png`));
  console.log(`rendered ${name} (${w}x${h})`);
}

// Crop to the declared artboard box and verify nothing was clipped.
execFileSync("python3", [join(here, "crop-posters.py"), out, JSON.stringify(ARTBOARDS)], {
  stdio: "inherit",
});
