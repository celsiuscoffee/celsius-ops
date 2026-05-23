import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ORDER_ROOT = resolve(here, "..");
const PICKUP_NATIVE = resolve(ORDER_ROOT, "..", "pickup-native");
const PICKUP_DIST = resolve(PICKUP_NATIVE, "dist");
const PUBLIC = resolve(ORDER_ROOT, "public");

const exec = (cmd, args, opts) =>
  new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...opts });
    p.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(" ")} exit ${code}`))));
    p.on("error", rej);
  });

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDistToPublic() {
  const entries = await readdir(PICKUP_DIST, { withFileTypes: true });
  for (const e of entries) {
    const src = resolve(PICKUP_DIST, e.name);
    const dst = resolve(PUBLIC, e.name);
    if (e.isDirectory()) {
      await mkdir(dst, { recursive: true });
      await cp(src, dst, { recursive: true, force: true });
    } else {
      await cp(src, dst, { force: true });
    }
  }
}

console.log("[build-pwa] Building Expo Web bundle in apps/pickup-native…");
if (!(await exists(PICKUP_NATIVE))) {
  throw new Error(`pickup-native not found at ${PICKUP_NATIVE}`);
}

// apps/pickup-native is NOT in the root package.json workspaces list
// (Expo + Metro have their own dep-resolution expectations). The root
// `npm install` Vercel runs therefore won't populate its node_modules.
//
// We run `npm install` UNCONDITIONALLY here, not just when node_modules
// is absent. Vercel restores node_modules from cache between builds,
// and the cached folder can be stale relative to package.json — e.g.
// after a new dep is added in a commit (react-native-webview 13.15.0
// for the RM in-app checkout modal), cache still has the older snapshot
// without that package, and Metro then fails to resolve it during
// `expo export -p web`, taking the whole celsius-pickup-app deploy
// down. `npm install` is a fast no-op when everything is already in
// sync (~2-5s), so this safety net is cheap.
console.log("[build-pwa] Syncing pickup-native deps (npm install)…");
// --include=dev forces devDependencies even when NODE_ENV=production
// (Vercel build context). patch-package itself is in regular deps as
// a belt-and-braces guard against that flag being ignored.
await exec("npm", ["install", "--no-audit", "--no-fund", "--include=dev"], {
  cwd: PICKUP_NATIVE,
});

// Mirror NEXT_PUBLIC_* env vars to EXPO_PUBLIC_* so the Expo bundle can
// read the same secrets (VAPID public key, Stripe publishable, Supabase
// URL/anon) without forcing the operator to duplicate them in Vercel.
// Already-set EXPO_PUBLIC_* values win — local apps/pickup-native/.env
// is not overridden.
const PUBLIC_PREFIX_MAP = [
  ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "EXPO_PUBLIC_VAPID_PUBLIC_KEY"],
  ["NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY"],
  ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
];
const passthroughEnv = { ...process.env };
for (const [from, to] of PUBLIC_PREFIX_MAP) {
  if (passthroughEnv[from] && !passthroughEnv[to]) {
    passthroughEnv[to] = passthroughEnv[from];
  }
}

await exec("npm", ["run", "export:web"], { cwd: PICKUP_NATIVE, env: passthroughEnv });

if (!(await exists(PICKUP_DIST))) {
  throw new Error(`Expo Web export missing at ${PICKUP_DIST}`);
}

console.log("[build-pwa] Removing stale SPA assets from public/_expo …");
await rm(resolve(PUBLIC, "_expo"), { recursive: true, force: true });

console.log("[build-pwa] Copying dist → public/ …");
await copyDistToPublic();

console.log("[build-pwa] Done.");
