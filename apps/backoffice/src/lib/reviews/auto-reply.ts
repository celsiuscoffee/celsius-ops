/**
 * Shared review auto-reply generator.
 *
 * Used by both the manual button (/api/reviews/auto-reply) and the
 * scheduled cron (/api/cron/reviews-auto-reply) so the brand-voice prompt
 * lives in exactly one place and can't drift between the two paths.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Negative-review escalation contact (used in the negative prompt only).
export const MANAGER_NAME = "Adam";
export const MANAGER_PHONE = "+60 17-657 9149";

// 4-5 = positive (safe to auto-post). 1-3 = negative (human-approval path).
export const POSITIVE_THRESHOLD = 4;

export type ReviewForReply = {
  rating: number;
  reviewer: string;
  comment?: string;
  outletName: string;
};

/** Generate a Google review reply in the Celsius owner voice. */
export async function generateReply(review: ReviewForReply): Promise<string> {
  const isPositive = review.rating >= POSITIVE_THRESHOLD;

  const prompt = isPositive
    ? `You are the owner of Celsius Coffee (${review.outletName}), a specialty coffee brand in Malaysia. Write a short, warm reply to this positive Google review. Be genuine, not generic. Thank them specifically for what they mentioned. Keep it 2-3 sentences max. Do not use emojis excessively — 1 max if any.

Reviewer: ${review.reviewer}
Rating: ${review.rating}/5
Review: ${review.comment || "(no comment, just a rating)"}

Reply:`
    : `You are the owner of Celsius Coffee (${review.outletName}), a specialty coffee brand in Malaysia. Write a calm, professional reply to this negative Google review. Be empathetic, acknowledge their concern without being defensive. End with a CTA to contact our Area Manager ${MANAGER_NAME} at ${MANAGER_PHONE} so we can make it right. Keep it 3-4 sentences. Do not use emojis.

Reviewer: ${review.reviewer}
Rating: ${review.rating}/5
Review: ${review.comment || "(no comment, just a low rating)"}

Reply:`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0];
  return text.type === "text" ? text.text.trim() : "";
}
