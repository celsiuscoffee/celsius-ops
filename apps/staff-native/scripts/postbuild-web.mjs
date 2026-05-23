import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const HTML = resolve("dist/index.html");

const HEAD_EXTRA = `
  <link rel="manifest" href="/manifest.json">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Celsius Staff">
  <meta name="format-detection" content="telephone=no">
`;

const BODY_EXTRA = `
  <script>
    // Real visible viewport in pixels — surfaces as --vph so html/body/#root
    // honor it. Sidesteps iOS Safari's flaky dvh/lvh/svh reporting in PWA
    // standalone mode (under-reports by ~150px).
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
  </script>
`;

const html = await readFile(HTML, "utf8");
if (html.includes("/manifest.json")) {
  console.log("postbuild-web: HTML already patched, skipping");
  process.exit(0);
}

const NEW_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';

const EXPO_RESET_OLD = `      html,
      body {
        height: 100%;
      }`;
const EXPO_RESET_NEW = `      html,
      body {
        height: 100vh; /* fallback */
        height: var(--vph, 100vh);
      }`;
const ROOT_OLD = `      #root {
        display: flex;
        height: 100%;
        flex: 1;
      }`;
const ROOT_NEW = `      #root {
        display: flex;
        height: 100vh;
        height: var(--vph, 100vh);
        flex: 1;
      }`;

const patched = html
  .replace(/<meta name="viewport"[^>]*\/?>/i, NEW_VIEWPORT)
  .replace(EXPO_RESET_OLD, EXPO_RESET_NEW)
  .replace(ROOT_OLD, ROOT_NEW)
  .replace("</head>", `${HEAD_EXTRA}</head>`)
  .replace("</body>", `${BODY_EXTRA}</body>`);

await writeFile(HTML, patched, "utf8");
console.log("postbuild-web: injected PWA shell into dist/index.html");
