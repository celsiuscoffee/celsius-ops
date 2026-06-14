// Startup env validation — the quality review found apps deploy fine
// with missing vars and then 500 at the first request that needs one.
//
// Policy (deliberate, see instrumentation.ts in each app):
//   * development  → THROW at boot. Fail fast on a misconfigured .env.
//   * production   → log one loud block + return the problems so the
//     caller can report to Sentry. NEVER throw: a missing optional-ish
//     var must not take a working deployment down with it.

export type EnvSpec = {
  /** App can't serve its core request paths without these. */
  required: string[];
  /** Feature-scoped: their absence silently disables a feature
   *  (payments webhook, SMS, AI) — worth a warning, never fatal. */
  recommended?: string[];
};

export type EnvProblems = {
  missingRequired: string[];
  missingRecommended: string[];
};

export function validateEnv(spec: EnvSpec): EnvProblems {
  const missing = (names: string[]) =>
    names.filter((n) => {
      const v = process.env[n];
      return v === undefined || v === "";
    });
  return {
    missingRequired: missing(spec.required),
    missingRecommended: missing(spec.recommended ?? []),
  };
}

/** Human-readable report, "" when everything is present. */
export function formatEnvReport(appName: string, p: EnvProblems): string {
  if (!p.missingRequired.length && !p.missingRecommended.length) return "";
  const lines = [`[env] ${appName}: environment problems detected`];
  for (const n of p.missingRequired) lines.push(`  MISSING (required): ${n}`);
  for (const n of p.missingRecommended) lines.push(`  missing (recommended): ${n}`);
  lines.push("  See .env.example at the repo root for every variable.");
  return lines.join("\n");
}

export type EnvCheckResult = {
  /** Human-readable report; "" when nothing is missing. */
  report: string;
  /** True when at least one REQUIRED var is missing. This is the only
   *  case that warrants a dev-boot throw or an error-level Sentry
   *  capture — a missing *recommended* var is non-fatal (it just
   *  disables a feature) and must NOT raise an error on every
   *  serverless cold start, which only buries real errors. */
  hasRequiredProblems: boolean;
};

/** One-call helper for instrumentation.ts. Returns the report ("" when
 *  clean) plus whether any REQUIRED var is missing, so the caller can
 *  forward only genuine problems to Sentry at error severity. */
export function checkEnvAtBoot(appName: string, spec: EnvSpec): EnvCheckResult {
  const problems = validateEnv(spec);
  const report = formatEnvReport(appName, problems);
  const hasRequiredProblems = problems.missingRequired.length > 0;
  if (!report) return { report: "", hasRequiredProblems: false };
  if (process.env.NODE_ENV !== "production" && hasRequiredProblems) {
    throw new Error(report);
  }
  // Always log the full block to the runtime logs (Vercel) — recommended
  // gaps stay discoverable there without paging Sentry.
  console.error(report);
  return { report, hasRequiredProblems };
}
