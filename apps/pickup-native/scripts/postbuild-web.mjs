import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const HTML = resolve("dist/index.html");

const HEAD_EXTRA = `
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="icon" type="image/png" href="/icons/icon-192.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Celsius">
  <meta name="format-detection" content="telephone=no">
`;

const BODY_EXTRA = `
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
      });
    }
  </script>
`;

const html = await readFile(HTML, "utf8");
if (html.includes("/manifest.json")) {
  console.log("postbuild-web: HTML already patched, skipping");
  process.exit(0);
}

// Replace Expo's default viewport meta — it ships with `shrink-to-fit=no`
// but not `viewport-fit=cover`, which iOS needs to extend the dark
// content behind the notch / dynamic island. Without it, installed
// PWAs render with a white status-bar band on top instead of the
// translucent immersive look apple-mobile-web-app-status-bar-style
// implies.
const NEW_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />';

// Expo's default expo-reset CSS uses `height: 100%`, which on
// iOS PWA standalone with viewport-fit=cover doesn't match the
// dynamic viewport — content stops short of the home-indicator
// area and leaves a white band below the bottom nav. Swap to
// 100dvh with a 100vh fallback for browsers that don't support
// the dynamic viewport unit yet (iOS <16.4, older Android).
const EXPO_RESET_OLD = `      html,
      body {
        height: 100%;
      }`;
const EXPO_RESET_NEW = `      html,
      body {
        height: 100vh;   /* baseline */
        height: 100lvh;  /* iOS PWA standalone reports the larger viewport */
        height: 100dvh;  /* dynamic — preferred where supported */
      }`;
const ROOT_OLD = `      #root {
        display: flex;
        height: 100%;
        flex: 1;
      }`;
const ROOT_NEW = `      #root {
        display: flex;
        height: 100vh;
        height: 100lvh;
        height: 100dvh;
        flex: 1;
      }`;

const patched = html
  .replace(
    /<meta name="viewport"[^>]*\/?>/i,
    NEW_VIEWPORT,
  )
  .replace(EXPO_RESET_OLD, EXPO_RESET_NEW)
  .replace(ROOT_OLD, ROOT_NEW)
  .replace("</head>", `${HEAD_EXTRA}</head>`)
  .replace("</body>", `${BODY_EXTRA}</body>`);

await writeFile(HTML, patched, "utf8");
console.log("postbuild-web: injected PWA shell into dist/index.html");
