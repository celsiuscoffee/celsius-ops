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
  <style>
    /* iOS Safari URL-bar collapse probe.
       Forces body to scroll (not the inner ScrollView) so iOS Safari
       sees document overflow and minimises its URL bar. Targets the
       first few levels of div nesting under #root because RN-Web's
       GestureHandlerRootView, SafeAreaProvider, expo-router Stack, and
       page-level Views all ship min-height:0 + flex:1 defaults that
       otherwise clamp content at viewport. Wide blast radius — if it
       breaks any screen layout, the right answer is to revert this
       block, not to add per-screen overrides.

       Scoped to web only (this whole file is the web postbuild). */
    html, body {
      overflow-x: hidden;
    }
    #root > *,
    #root > * > *,
    #root > * > * > *,
    #root > * > * > * > *,
    #root > * > * > * > * > * {
      flex: 0 0 auto !important;
      min-height: 0 !important;
      height: auto !important;
      overflow: visible !important;
    }
    /* Keep portals (BottomNav, MenuCartFloatingBar) anchored to the
       viewport — they're children of <body>, not descendants of #root,
       so the rules above don't touch them. */
  </style>
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

// Body uses min-height so the document can grow with content. Paired
// with the brute-force CSS in HEAD_EXTRA that forces every ancestor
// under #root to be content-sized (flex:0 0 auto, overflow:visible,
// min-height:0). Without that pairing this min-height does nothing —
// see PR #150 for the lesson. With it, body actually overflows when
// content exceeds the viewport, and iOS Safari collapses its URL bar.
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
