/**
 * Weekly Google Post generator for the local-rank loop.
 *
 * A fresh Google Post each week is a real prominence signal (active profile +
 * keyword-rich content). This produces the post copy in the Celsius owner voice;
 * the cron (/api/cron/reviews-weekly-post) publishes it via createLocalPost.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type WeeklyPostInput = {
  outletName: string;
  city?: string | null;
  keywords?: string[]; // tracked geogrid keywords, woven in naturally for relevance
};

/** A short STANDARD Google Post (~1-2 sentences) in the Celsius owner voice. */
export async function generateWeeklyPost(input: WeeklyPostInput): Promise<string> {
  const kw = (input.keywords ?? []).filter(Boolean).slice(0, 3);
  const kwLine = kw.length ? `\nWork in one of these search terms naturally (do not stuff): ${kw.join(", ")}.` : "";
  const where = input.city ? ` in ${input.city}` : "";

  const prompt = `You are the owner of Celsius Coffee (${input.outletName}), a specialty coffee café${where} in Malaysia. Write ONE short Google Business Profile post (an "update") to keep the profile active and inviting. Make it feel current and warm, like a real person inviting locals to drop by this week.

Rules:
- 1 to 2 short sentences, max ~220 characters.
- Concrete and inviting (a seasonal drink, the espresso, a cozy spot to work, weekend vibes). Vary it; do not sound templated.
- No fake discounts or claims. No hashtags. At most one emoji, usually none.
- Do NOT use em-dashes or en-dashes; use commas, periods, or "and".${kwLine}

Post:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 160,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0];
  return text.type === "text" ? text.text.trim().replace(/^["']|["']$/g, "") : "";
}
