// Builds apps/staff-native's Expo Web export, then copies the dist into
// apps/staff/public so the Next.js server (apps/staff) ships the native
// SPA at the root of staff.celsiuscoffee.com while /api/* keeps hitting
// Next.js route handlers.
//
// Wire into apps/staff/package.json `build` once the cutover is ready:
//   "build": "node scripts/build-pwa.mjs && prisma generate ... && next build"

import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const STAFF_ROOT = resolve(here, "..");
const STAFF_NATIVE = resolve(STAFF_ROOT, "..", "staff-native");
const STAFF_NATIVE_DIST = resolve(STAFF_NATIVE, "dist");
const PUBLIC = resolve(STAFF_ROOT, "public");

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
  const entries = await readdir(STAFF_NATIVE_DIST, { withFileTypes: true });
  for (const e of entries) {
    const src = resolve(STAFF_NATIVE_DIST, e.name);
    const dst = resolve(PUBLIC, e.name);
    if (e.isDirectory()) {
      await mkdir(dst, { recursive: true });
      await cp(src, dst, { recursive: true, force: true });
    } else {
      await cp(src, dst, { force: true });
    }
  }
}

console.log("[build-pwa] Building Expo Web bundle in apps/staff-native…");

if (!(await exists(STAFF_NATIVE))) {
  throw new Error(`staff-native not found at ${STAFF_NATIVE}`);
}

// apps/staff-native is NOT in the root npm workspaces list (Expo + Metro
// have their own dep-resolution expectations). Root install Vercel runs
// won't populate its node_modules — install on first build.
if (!(await exists(resolve(STAFF_NATIVE, "node_modules")))) {
  console.log("[build-pwa] Installing staff-native deps (first run)…");
  await exec("npm", ["install", "--no-audit", "--no-fund", "--include=dev"], {
    cwd: STAFF_NATIVE,
  });
}

// Mirror NEXT_PUBLIC_* env vars to EXPO_PUBLIC_* so the Expo bundle can
// read the same Supabase/Sentry config without forcing duplication in
// Vercel. Already-set EXPO_PUBLIC_* values win — local .env wins over
// the inherited NEXT_PUBLIC_ value.
const PUBLIC_PREFIX_MAP = [
  ["NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "EXPO_PUBLIC_SUPABASE_ANON_KEY"],
  ["NEXT_PUBLIC_SENTRY_DSN", "EXPO_PUBLIC_SENTRY_DSN"],
];
const passthroughEnv = { ...process.env };
passthroughEnv.EXPO_PUBLIC_STAFF_API_URL =
  passthroughEnv.EXPO_PUBLIC_STAFF_API_URL ?? "";
for (const [from, to] of PUBLIC_PREFIX_MAP) {
  if (passthroughEnv[from] && !passthroughEnv[to]) {
    passthroughEnv[to] = passthroughEnv[from];
  }
}

await exec("npm", ["run", "export:web"], {
  cwd: STAFF_NATIVE,
  env: passthroughEnv,
});

if (!(await exists(STAFF_NATIVE_DIST))) {
  throw new Error(`Expo Web export missing at ${STAFF_NATIVE_DIST}`);
}

console.log("[build-pwa] Copying dist/ → apps/staff/public/…");
await copyDistToPublic();
console.log("[build-pwa] Done.");
