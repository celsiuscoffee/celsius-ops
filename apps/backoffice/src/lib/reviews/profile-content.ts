/**
 * Auto-drafted Google Business Profile description for the hands-off rank loop.
 * The cron (/api/cron/reviews-profile-autofill) pushes this when an outlet has
 * no description set, so profile completeness needs nobody in the loop.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type DescriptionInput = {
  outletName: string;
  city?: string | null;
  keywords?: string[];
};

/** A Google Business Profile description in the Celsius owner voice (<=700 chars). */
export async function generateDescription(input: DescriptionInput): Promise<string> {
  const kw = (input.keywords ?? []).filter(Boolean).slice(0, 3);
  const kwLine = kw.length ? `\nWeave in one or two of these search terms naturally (no stuffing): ${kw.join(", ")}.` : "";
  const where = input.city ? ` in ${input.city}` : "";

  const prompt = `Write the Google Business Profile "description" for Celsius Coffee (${input.outletName}), a specialty coffee café${where} in Malaysia.

Rules:
- 2 to 3 sentences, max ~600 characters.
- Warm and specific: specialty coffee, espresso-based drinks, brunch/food, and a cozy spot to work or catch up.
- No discounts or unverifiable claims. No hashtags, no emojis.
- Do NOT use em-dashes or en-dashes; use commas, periods, or "and".${kwLine}

Description:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0];
  return text.type === "text" ? text.text.trim().replace(/^["']|["']$/g, "") : "";
}
