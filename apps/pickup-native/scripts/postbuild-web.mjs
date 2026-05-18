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

    // Walk the DOM and tag any element with computed overflow-y of
    // auto/scroll so the CSS rule above can strip it. Required because
    // react-native-web emits overflow on dynamically-generated atomic
    // classes whose hashes change between bundle builds, so we can't
    // target them with a single static selector. Runs once at first
    // paint and then on every React render via MutationObserver.
    (function () {
      function tag(root) {
        var all = (root || document).querySelectorAll('div');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (el === document.body || el === document.documentElement) continue;
          if (el.classList.contains('force-no-overflow')) continue;
          var cs = getComputedStyle(el);
          if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
            el.classList.add('force-no-overflow');
          }
        }
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { tag(); });
      } else {
        tag();
      }
      // Keep neutralizing on every DOM change — React re-renders
      // recreate the nodes, so the class needs reapplying.
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'childList') tag(m.target);
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
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
         so body owns the scroll. iOS Safari only auto-hides its URL
         bar when scroll events fire on the document scrolling element
         (body/html), not when they're intercepted by an internal
         overflow:auto container. The JS at the bottom of <body>
         walks the DOM and adds .force-no-overflow to anything with
         computed overflow-y of auto/scroll; this rule then strips it.
         Belt-and-braces with a hardcoded match for the class
         react-native-web 0.21 currently emits for overflow-y:auto. */
      .force-no-overflow,
      .r-1rnoaur,
      [class~="r-1rnoaur"] {
        overflow-y: visible !important;
        overflow-x: visible !important;
        height: auto !important;
        max-height: none !important;
        -ms-overflow-style: none !important;
        scrollbar-width: none !important;
      }
      /* Bottom nav is portalled to <body> and uses position: fixed
         at the viewport bottom. Reserve space at the end of body so
         the last content row isn't covered by it. ~84px = nav row
         + safe-area-inset-bottom on iPhone. */
      body {
        padding-bottom: calc(84px + env(safe-area-inset-bottom, 0px));
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
