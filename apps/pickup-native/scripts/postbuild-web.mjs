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

// Replace Expo's default viewport meta — it ships with `shrink-to-fit=no`
// but not `viewport-fit=cover`, which iOS needs to extend the dark
// content behind the notch / dynamic island. Without it, installed
// PWAs render with a white status-bar band on top instead of the
// translucent immersive look apple-mobile-web-app-status-bar-style
// implies.
// Dropped `maximum-scale=1` — it doesn't actually disable zoom on
// modern iOS Safari and has been observed to interfere with viewport
// height reporting in PWA standalone mode.
const NEW_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';

// Expo's expo-reset ships `body { overflow: hidden }` — fine on
// native, but on iOS Safari it prevents the URL bar from auto-hiding
// on scroll because the body never receives scroll events
// (everything is intercepted by React Native ScrollView). Override
// to `auto` so iOS Safari detects scroll and shrinks the URL bar
// the way Google / first-party web apps do. Combined with the
// --vph JS measurement, the bottom nav re-anchors as the viewport
// grows.
const BODY_OVERFLOW_OLD = `      body {
        overflow: hidden;
      }`;
const BODY_OVERFLOW_NEW = `      body {
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: none;
      }`;

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
        /* One continuous scroll: body owns the scroll, not React
           Native ScrollView. min-height keeps the viewport filled
           when content is short; height auto lets long content grow
           the page so body actually scrolls (and iOS Safari hides
           its URL bar). --vph is set by JS to window.innerHeight
           in real pixels — sidesteps iOS Safari's lying viewport
           units. */
        min-height: 100vh; /* fallback */
        min-height: var(--vph, 100vh);
        height: auto;
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
        flex: 1;
      }
      /* Kill the internal scroll on every react-native-web ScrollView
         that's tall enough to hit its overflow:auto. We want the body
         to do the scrolling instead so iOS Safari can hide its URL
         bar AND so the whole document scrolls as one unit (the bottom
         nav is now an inline element at the end of flow, no longer
         pinned). Targets the dynamically-generated class
         react-native-web emits for ScrollView's outer wrapper —
         every ScrollView has \`overflow-y: scroll\` or \`auto\` on its
         host node. */
      [class*="r-overflowY"] {
        overflow-y: visible !important;
        height: auto !important;
        max-height: none !important;
      }`;

const patched = html
  .replace(
    /<meta name="viewport"[^>]*\/?>/i,
    NEW_VIEWPORT,
  )
  .replace(EXPO_RESET_OLD, EXPO_RESET_NEW)
  .replace(BODY_OVERFLOW_OLD, BODY_OVERFLOW_NEW)
  .replace(ROOT_OLD, ROOT_NEW)
  .replace("</head>", `${HEAD_EXTRA}</head>`)
  .replace("</body>", `${BODY_EXTRA}</body>`);

await writeFile(HTML, patched, "utf8");
console.log("postbuild-web: injected PWA shell into dist/index.html");
