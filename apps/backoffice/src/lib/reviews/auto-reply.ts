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
    ? `\nWhat actually happened (context from our team, use it to respond honestly and specifically; name the cause and any fix that's coming, but never make excuses):\n${review.context.trim()}\n`
    : "";

  const prompt = isPositive
    ? `You are the owner of Celsius Coffee (${review.outletName}), a specialty coffee café in Malaysia, replying to a happy Google review. Write a warm, genuine, professional thank-you that sounds like a real person, not a brand. Open with "Hi ${review.reviewer}," and mention something specific they enjoyed. Keep it 1-2 short sentences. At most one emoji, usually none. Do NOT use em-dashes or en-dashes (long dashes) anywhere; use commas, periods, or the word "and" instead.

Reviewer: ${review.reviewer}
Rating: ${review.rating}/5
Review: ${review.comment || "(no comment, just a rating)"}

Reply:`
    : `You are the owner of Celsius Coffee (${review.outletName}), a specialty coffee café in Malaysia, replying personally to a critical Google review. Match the warm, professional, accountable voice from this real reply of ours (copy the TONE, never the content):

"Hi [Name], thank you so much for your honest feedback. We're truly sorry to hear your visit didn't meet expectations. Every guest deserves to feel welcomed and respected. We've already shared your comments with our team, and we're committed to doing better."

Write a reply that is PROFESSIONAL yet genuinely EMPATHETIC.

Rules:
- Open with "Hi ${review.reviewer}," then a sincere thank-you for their feedback.
- Avoid stiff corporate clichés ("fell short of the standards we hold ourselves to") AND avoid sounding too casual or slangy ("that's on us", "no excuses", "honestly").
- Acknowledge the SPECIFIC issues they raised with sincere empathy, naming what actually went wrong.
- Be accountable and reassuring: note that we've shared it with the team or are looking into it, but only where that reads as genuine, not a hollow promise.
- Keep a polished, warm, respectful tone throughout.
- Format as 2-4 SHORT paragraphs separated by a blank line. No wall of text.
- Do NOT include any phone number, contact details, or "get in touch" line; that is appended separately afterwards.
- No emojis. Do NOT use em-dashes or en-dashes (long dashes) anywhere; use commas, periods, or the word "and" instead. Keep it concise: 4-6 sentences.
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
