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

/** One-call helper for instrumentation.ts. Returns the report string
 *  ("" when clean) so the caller can also forward it to Sentry. */
export function checkEnvAtBoot(appName: string, spec: EnvSpec): string {
  const problems = validateEnv(spec);
  const report = formatEnvReport(appName, problems);
  if (!report) return "";
  if (process.env.NODE_ENV !== "production" && problems.missingRequired.length) {
    throw new Error(report);
  }
  console.error(report);
  return report;
}
