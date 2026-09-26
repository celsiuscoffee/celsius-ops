/**
 * Audit-window resolution for the reconcile-failed sweep.
 *
 * Deliberately dependency-free and in its own module: the root vitest config
 * maps the `@/` alias to apps/backoffice/src, so a test that reaches route.ts
 * (which imports `@/lib/...`) cannot load in the repo-wide run.
 *
 * `minutes` wins when present — that is the cron's narrow self-healing sweep,
 * which runs with apply=true. `days` is the operator's wide historical audit,
 * which stays dry-run by default. Both are clamped so a mistyped parameter
 * can never turn the 5-minute cron into a 90-day auto-settle.
 */
export function resolveWindow(
  minutesParam: string | null,
  daysParam: string | null,
): { windowMs: number; label: string } {
  if (minutesParam != null) {
    const minutes = Math.min(Math.max(Number(minutesParam) || 0, 1), 1440);
    return { windowMs: minutes * 60 * 1000, label: `${minutes}m` };
  }
  const days = Math.min(Math.max(Number(daysParam ?? 30) || 30, 1), 90);
  return { windowMs: days * 24 * 60 * 60 * 1000, label: `${days}d` };
}
