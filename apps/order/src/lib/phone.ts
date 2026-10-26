// Malaysian phone canonicalisation — one source of truth for the order app.
//
// The same customer reaches us as "+60123456789", "60123456789" or
// "0123456789" depending on which screen captured the number. Rows must be
// WRITTEN in one form and LOOKED UP under all of them. When those two rules
// drift apart, customers lose their own data: as of 2026-10-26, 67 app orders
// stored as "0…" were invisible to the people who placed them, because the
// Orders tab searched only "+60…" — 36 customers saw "No orders yet" for
// orders they had paid for. That empty screen looked identical to the old
// pre-tabs build, so it was misreported for months as an OTA regression.
//
// Dependency-free on purpose, so it is unit-testable from the root vitest run
// (whose "@" alias points at backoffice, not this app).

/** Canonical E.164 form every row is written in: "+60123456789". */
export function canonicalPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("60")) return `+${d}`;
  if (d.startsWith("0")) return `+6${d}`;
  return `+60${d}`;
}

/** Every stored form of the same number, for lookups that must also find
 *  legacy rows written before canonicalisation. Includes the raw input. */
export function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, "");
  const variants: string[] = [phone];
  if (d.startsWith("60")) {
    variants.push(`+${d}`, d, `0${d.slice(2)}`);
  } else if (d.startsWith("0")) {
    variants.push(`+6${d}`, `6${d}`, d);
  } else {
    variants.push(`+60${d}`, `60${d}`, `0${d}`);
  }
  return [...new Set(variants)];
}
