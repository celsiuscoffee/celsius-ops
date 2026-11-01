import { describe, expect, it } from "vitest";
import { mentionsOffer, REVIEW_CONTACT_LINE, stripRecoveryOffer } from "./reply-offer";

describe("stripRecoveryOffer", () => {
  it("swaps the recovery-link paragraph for the contact line", () => {
    const reply =
      "Hi Aina, thank you for your feedback.\n\nWe're sorry the latte was cold.\n\nWe'd like to make this right. Please visit https://backoffice.celsiuscoffee.com/recover/AB3XK9 so we can reach you personally.";
    expect(stripRecoveryOffer(reply)).toBe(
      `Hi Aina, thank you for your feedback.\n\nWe're sorry the latte was cold.\n\n${REVIEW_CONTACT_LINE}`,
    );
  });

  it("matches a vanity recovery URL by its wording", () => {
    const reply = "Hi Sam, sorry.\n\nWe'd like to make this right. Please visit https://celsiuscoffee.com/sorry/QW7ER2 so we can reach you personally.";
    expect(stripRecoveryOffer(reply)).toBe(`Hi Sam, sorry.\n\n${REVIEW_CONTACT_LINE}`);
  });

  it("leaves replies without a recovery link alone", () => {
    expect(stripRecoveryOffer("Hi Lee, thanks for visiting!")).toBeNull();
  });

  it("output no longer mentions an offer", () => {
    const out = stripRecoveryOffer("Hi.\n\nPlease visit https://x.com/recover/ZZZ222 so we can reach you personally.")!;
    expect(out).not.toMatch(/recover/);
    expect(mentionsOffer(out)).toBe(false);
  });
});

describe("mentionsOffer", () => {
  it("flags hand-written incentives in English and Malay", () => {
    expect(mentionsOffer("Next drink is on the house!")).toBe(true);
    expect(mentionsOffer("Kami beri baucar untuk anda")).toBe(true);
    expect(mentionsOffer("Thanks for the kind words")).toBe(false);
  });
});
