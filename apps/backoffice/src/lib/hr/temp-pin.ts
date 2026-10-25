/**
 * Temporary PIN derivation for a new hire.
 *
 * Owner 2026-10-24: the PIN HR hands over should be the first six digits of
 * the employee's IC — their date of birth — and it must be replaced at first
 * sign-in.
 *
 * WHY A GUESSABLE PIN IS ACCEPTABLE HERE, AND ONLY HERE. A PIN is the whole
 * staff-app credential: no username, no password. A date of birth is known to
 * every colleague (the app literally has a birthday-celebrations feature), so
 * on its own this would let anyone clock in as anyone. It is safe ONLY as a
 * one-use handover value that `User.mustChangePin` forces the holder to
 * replace before they can do anything else. Never issue a derived PIN without
 * also setting that flag.
 *
 * The derivation deliberately REFUSES rather than improvises:
 *   - no IC, or an IC that isn't 12 digits → null, and HR picks a number;
 *   - the derived PIN already belongs to someone → the caller is told, and
 *     HR picks a number. Silently sliding to a different PIN would leave HR
 *     telling the new hire a number that is not theirs.
 */

export const TEMP_PIN_LENGTH = 6;

export type TempPinResult =
  | { ok: true; pin: string }
  | { ok: false; reason: "no_ic" | "bad_ic" | "taken" };

/**
 * First six digits of a Malaysian IC (YYMMDD), or null when the IC is missing
 * or not 12 digits. Separators are ignored, so both `050310101364` and
 * `050310-10-1364` yield `050310`.
 */
export function tempPinFromIc(icRaw: string | null | undefined): string | null {
  if (typeof icRaw !== "string") return null;
  const digits = icRaw.replace(/\D/g, "");
  if (digits.length !== 12) return null;
  return digits.slice(0, TEMP_PIN_LENGTH);
}

/**
 * Resolve the temp PIN for a hire, given a way to test whether a candidate is
 * already in use. `isTaken` is injected so this stays pure and testable — in
 * production it is `pinInUse` from pin-policy.
 */
export async function resolveTempPin(
  icRaw: string | null | undefined,
  isTaken: (pin: string) => Promise<boolean>,
): Promise<TempPinResult> {
  if (typeof icRaw !== "string" || icRaw.trim() === "") {
    return { ok: false, reason: "no_ic" };
  }
  const pin = tempPinFromIc(icRaw);
  if (!pin) return { ok: false, reason: "bad_ic" };
  if (await isTaken(pin)) return { ok: false, reason: "taken" };
  return { ok: true, pin };
}

/** What to tell the person issuing the PIN when derivation failed. */
export function tempPinRefusal(reason: Exclude<TempPinResult, { ok: true }>["reason"]): string {
  switch (reason) {
    case "no_ic":
      return "No IC on file, so a PIN can't be derived from it — enter a 6-digit PIN instead.";
    case "bad_ic":
      return "The IC on file isn't 12 digits, so a PIN can't be derived from it — enter a 6-digit PIN instead.";
    case "taken":
      // Two people born on the same day. Rare, but PINs share one namespace,
      // so the second one must not be issued.
      return "The PIN from this IC is already used by another account — enter a different 6-digit PIN.";
  }
}
