// Google's review policy forbids offering anything of value in connection with
// a review, including to a reviewer who complained. Public replies therefore
// carry only a neutral contact line; any make-good happens privately after the
// customer reaches out (manager "compensate" action on the case).

export const REVIEW_CONTACT_PHONE = process.env.REVIEW_CONTACT_PHONE || "+60 11-3750 6488";

export const REVIEW_CONTACT_LINE = `We'd like to make this right. Please contact us at ${REVIEW_CONTACT_PHONE} so we can follow up with you personally.`;

// The paragraph the old approve flow appended: "...Please visit <base>/<CODE> so
// we can reach you personally." Matched by the fixed wording as well as the path,
// since RECOVERY_URL_BASE may have pointed at a vanity domain.
const RECOVERY_PARAGRAPH = /\/recover\/[A-Za-z0-9]+|so we can reach you personally/i;

// Hand-written offers the automated rewrite can't safely edit — flagged for a human.
const OFFER_WORDS = /free (coffee|drink|cup)|voucher|complimentary|on the house|discount|percuma|baucar/i;

export function mentionsOffer(reply: string): boolean {
  return OFFER_WORDS.test(reply);
}

/** Reply with the recovery-link paragraph swapped for the contact line, or null if it has none. */
export function stripRecoveryOffer(reply: string): string | null {
  const paragraphs = reply.split(/\n\s*\n/);
  const kept = paragraphs.filter((p) => !RECOVERY_PARAGRAPH.test(p));
  if (kept.length === paragraphs.length) return null;
  return [...kept.map((p) => p.trim()).filter(Boolean), REVIEW_CONTACT_LINE].join("\n\n");
}
