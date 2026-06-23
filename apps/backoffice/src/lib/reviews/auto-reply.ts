/**
 * Shared review auto-reply generator.
 *
 * Used by both the manual button (/api/reviews/auto-reply) and the
 * scheduled cron (/api/cron/reviews-auto-reply) so the brand-voice prompt
 * lives in exactly one place and can't drift between the two paths.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 4-5 = positive (safe to auto-post). 1-3 = negative (human-approval path).
export const POSITIVE_THRESHOLD = 4;

export type ReviewForReply = {
  rating: number;
  reviewer: string;
  comment?: string;
  outletName: string;
  context?: string; // approver's notes on what actually happened — for regeneration
};

/** Generate a Google review reply in the Celsius owner voice. */
export async function generateReply(review: ReviewForReply): Promise<string> {
  const isPositive = review.rating >= POSITIVE_THRESHOLD;

  const contextBlock = review.context?.trim()
    ? `\nWhat actually happened (context from our team — use it to respond honestly and specifically; name the cause and any fix that's coming, but never make excuses):\n${review.context.trim()}\n`
    : "";

  const prompt = isPositive
    ? `You are the owner of Celsius Coffee (${review.outletName}), a specialty coffee café in Malaysia, replying to a happy Google review. Write a short, warm, genuine thank-you — like a real person, not a brand. Vary your opening (do not always start with "Thank you"). Mention something specific they said. 1-2 short sentences. At most one emoji, usually none.

Reviewer: ${review.reviewer}
Rating: ${review.rating}/5
Review: ${review.comment || "(no comment, just a rating)"}

Reply:`
    : `You are the owner of Celsius Coffee (${review.outletName}), a specialty coffee café in Malaysia, replying personally to a critical Google review. Write like a real owner who genuinely cares — NOT a corporate template.

Rules:
- Do NOT open with "Dear ${review.reviewer}, thank you for taking the time to share your feedback" or any stock phrase. Vary the opening and sound human.
- Respond to the SPECIFIC things they raised (name the actual issues). No generic platitudes like "fell short of the standards we hold ourselves to".
- Be warm and accountable; don't be defensive and don't over-apologise.
- Format as 2-3 SHORT paragraphs separated by a blank line. No wall of text.
- Do NOT include any phone number, contact details, or "get in touch" line — that is appended separately afterwards.
- No emojis. Keep it tight: 3-5 short sentences total.
${contextBlock}
Reviewer: ${review.reviewer}
Rating: ${review.rating}/5
Their review: ${review.comment || "(no comment, just a low rating)"}

Reply:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0];
  return text.type === "text" ? text.text.trim() : "";
}
