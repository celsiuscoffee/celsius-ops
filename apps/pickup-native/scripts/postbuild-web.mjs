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
    // Measure the real visible viewport in pixels and surface it as
    // --vph. Drives html/body/#root height via the expo-reset rules
    // — sidesteps iOS Safari's flaky dvh/lvh/svh reporting in PWA
    // standalone. Prefer window.visualViewport when available; it
    // tracks pinch-zoom + virtual keyboard correctly.
    (function () {
      function set() {
        var h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
        document.documentElement.style.setProperty('--vph', h + 'px');
      }
      set();
      window.addEventListener('resize', set, { passive: true });
      window.addEventListener('orientationchange', set, { passive: true });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', set, { passive: true });
        window.visualViewport.addEventListener('scroll', set, { passive: true });
      }
    })();

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

// viewport-fit=cover so iOS extends content behind the notch /
// dynamic island. Dropped maximum-scale=1 — it doesn't actually
// disable zoom on modern iOS Safari.
const NEW_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';

// Body must be allowed to scroll past viewport height — without that,
// iOS Safari has no trigger to collapse its URL bar, which permanently
// eats ~120px of viewport on the customer's phone. Switching from a
// pinned `height: var(--vph)` to `min-height: 100dvh` (with the older
// JS-measured --vph as fallback for browsers that ship without dvh)
// keeps the background filling the visible area at minimum but lets
// content + the inner ScrollView push the document taller, which is
// what triggers the URL bar collapse.
const EXPO_RESET_OLD = `      html,
      body {
        height: 100%;
      }`;
const EXPO_RESET_NEW = `      html,
      body {
        min-height: 100vh; /* fallback */
        min-height: var(--vph, 100vh);
        min-height: 100dvh;
      }`;
const ROOT_OLD = `      #root {
        display: flex;
        height: 100%;
        flex: 1;
      }`;
const ROOT_NEW = `      #root {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        min-height: var(--vph, 100vh);
        min-height: 100dvh;
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
