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

    // Defeat RN-Web's inner ScrollView so the document scrolls — that's
    // what iOS Safari watches to collapse its URL bar.
    //
    // Strategy: on every render, find the OUTERMOST vertical scroller
    // under #root (the page's main ScrollView), release its
    // overflow/flex constraints, then walk up the ancestor chain to
    // #root, doing the same. Deeper elements that legitimately need
    // overflow:hidden (rounded card images, carousels, tier cards) are
    // untouched. Horizontal carousels (overflow-x: auto, overflow-y
    // hidden) are also untouched.
    //
    // Earlier attempts (#157/#158) used blanket CSS like '#root *' which
    // hit every descendant and broke clipping. This is surgical.
    (function () {
      var FIXED = '__celsiusBodyScrollFixed';
      function isVerticalScroller(el) {
        if (!el || el.nodeType !== 1) return false;
        var cs = window.getComputedStyle(el);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
          && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
      }
      function findOutermost(root) {
        if (!root) return null;
        var queue = [root];
        while (queue.length) {
          var node = queue.shift();
          if (node !== root && isVerticalScroller(node)) return node;
          for (var i = 0; i < node.children.length; i++) queue.push(node.children[i]);
        }
        return null;
      }
      function release(el) {
        el.style.setProperty('overflow', 'visible', 'important');
        el.style.setProperty('flex-grow', '0', 'important');
        el.style.setProperty('flex-shrink', '0', 'important');
        el.style.setProperty('flex-basis', 'auto', 'important');
        el.style.setProperty('min-height', '0', 'important');
        el.style.setProperty('height', 'auto', 'important');
      }
      function tick() {
        var root = document.getElementById('root');
        if (!root) return;
        var sv = findOutermost(root);
        if (!sv) return;
        if (sv[FIXED]) return;
        release(sv);
        var el = sv.parentElement;
        while (el && el !== document.body) {
          release(el);
          if (el === root) break;
          el = el.parentElement;
        }
        sv[FIXED] = true;
      }
      var raf = 0;
      function schedule() {
        if (raf) return;
        raf = requestAnimationFrame(function () { raf = 0; tick(); });
      }
      window.addEventListener('DOMContentLoaded', schedule);
      window.addEventListener('load', schedule);
      window.addEventListener('popstate', schedule);
      // Patch pushState/replaceState so route changes also trigger the fix.
      ['pushState', 'replaceState'].forEach(function (m) {
        var orig = history[m];
        history[m] = function () {
          var r = orig.apply(this, arguments);
          schedule();
          return r;
        };
      });
      // React re-renders the screen content under #root — re-check after
      // each batch of DOM mutations. The FIXED flag means each scroller
      // is only released once.
      var mo = new MutationObserver(schedule);
      mo.observe(document.documentElement, { childList: true, subtree: true });
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

// Body uses min-height so the document can grow with content — that
// growth is what iOS Safari watches to collapse its URL bar. Paired
// with the runtime BODY_SCROLL_SCRIPT below that surgically defeats
// the outermost RN-Web ScrollView's clamping so its content actually
// extends the document. Previous CSS-only attempts (#157/#158) reached
// every descendant with !important and broke cards/images that need
// overflow: hidden for rounded clipping. The JS-walk approach only
// touches the chain from #root down to the main ScrollView — deeper
// elements (ProductImage, TierCard, VoucherWallet, etc.) keep their
// inline overflow rules.
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
