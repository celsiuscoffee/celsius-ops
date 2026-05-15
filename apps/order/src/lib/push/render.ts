/**
 * Tiny mustache-style template renderer for campaign copy. Replaces
 * {{variable}} with values from the supplied vars map. Missing vars
 * leave the placeholder intact so admins notice (better than silent
 * empty interpolation).
 *
 * Why bespoke instead of pulling in a real templating lib:
 *   - We control the input — no need to defend against arbitrary
 *     template injection.
 *   - One file, no deps, no engine startup cost. Cold-start of the
 *     cron Lambda is hot path.
 *   - The variable surface is intentionally small (drink names,
 *     numbers, first names) — Mustache / Handlebars features like
 *     loops or conditionals would be over-engineered for the use case.
 *
 * Plurals: any var name X automatically gets a paired Xplural that
 * resolves to "s" when X is a number > 1 (or string "1") and ""
 * otherwise. So "{{daysLeft}} day{{daysLeftPlural}}" → "1 day" / "3 days"
 * without admins thinking about it.
 */

export type TemplateVars = Record<string, string | number | null | undefined>;

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function renderTemplate(template: string | null | undefined, vars: TemplateVars): string {
  if (!template) return "";
  // Build the plural-helper companion vars first so the renderer
  // sees them in one pass. Any numeric (or "1"/"2"/etc string) var
  // foo gets fooPlural = "" or "s" automatically.
  const enriched: TemplateVars = { ...vars };
  for (const [k, v] of Object.entries(vars)) {
    if (k.endsWith("Plural")) continue;
    const n = typeof v === "number" ? v : (typeof v === "string" && /^-?\d+$/.test(v) ? Number(v) : null);
    if (n !== null) {
      const pluralKey = `${k}Plural`;
      if (enriched[pluralKey] === undefined) {
        enriched[pluralKey] = Math.abs(n) === 1 ? "" : "s";
      }
    }
  }

  return template.replace(VAR_RE, (match, name: string) => {
    const v = enriched[name];
    if (v === null || v === undefined) return match;
    return String(v);
  });
}
