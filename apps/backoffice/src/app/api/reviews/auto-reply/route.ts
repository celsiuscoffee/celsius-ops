import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchGoogleReviews, replyToReview } from "@/lib/reviews/gbp";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MANAGER_NAME = "Adam";
const MANAGER_PHONE = "+60 17-657 9149";

// Generate a reply using Claude
async function generateReply(review: {
  rating: number;
  reviewer: string;
  comment?: string;
  outletName: string;
}): Promise<string> {
  const isPositive = review.rating >= 4; // 4-5 = good (auto-post), 1-3 = bad (approval)

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
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0];
  return text.type === "text" ? text.text.trim() : "";
}

// POST /api/reviews/auto-reply
// Body: { outletId, reviewId, mode: "preview" | "post" }
// - preview: generate reply without posting
// - post: generate and post to GBP
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { outletId, reviewId, mode = "preview" } = await request.json();
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const settings = await prisma.reviewSettings.findUnique({
    where: { outletId },
    include: { outlet: { select: { name: true } } },
  });
  if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
    return NextResponse.json({ error: "GBP not connected" }, { status: 400 });
  }

  const outletName = settings.outlet.name;

  // If reviewId provided, reply to single review
  if (reviewId) {
    const data = await fetchGoogleReviews(settings.gbpAccountId, settings.gbpLocationName, 50);
    const review = data.reviews.find((r) => r.id === reviewId);
    if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });
    if (review.reply) return NextResponse.json({ error: "Already replied", skipped: true });

    const reply = await generateReply({
      rating: review.rating,
      reviewer: review.reviewer.name,
      comment: review.comment,
      outletName,
    });

    if (mode === "post") {
      await replyToReview(settings.gbpAccountId, settings.gbpLocationName, reviewId, reply);
    }

    return NextResponse.json({ reviewId, reply, posted: mode === "post" });
  }

  // No reviewId = batch auto-reply all unreplied reviews
  // Good reviews (4-5 stars): auto-post immediately
  // Bad reviews (1-3 stars): generate draft for approval only
  const data = await fetchGoogleReviews(settings.gbpAccountId, settings.gbpLocationName, 50);
  const unreplied = data.reviews.filter((r) => !r.reply);

  if (unreplied.length === 0) {
    return NextResponse.json({ message: "All reviews already replied", results: [], posted: 0, pending: 0 });
  }

  const results = [];
  let postedCount = 0;
  let pendingCount = 0;

  for (const review of unreplied) {
    try {
      const isPositive = review.rating >= 4; // 4-5 = good (auto-post), 1-3 = bad (approval)
      const reply = await generateReply({
        rating: review.rating,
        reviewer: review.reviewer.name,
        comment: review.comment,
        outletName,
      });

      // Good reviews: auto-post. Bad reviews: draft only (needs approval).
      const shouldPost = isPositive && mode === "post";
      if (shouldPost) {
        await replyToReview(settings.gbpAccountId, settings.gbpLocationName, review.id, reply);
        postedCount++;
      } else if (!isPositive) {
        pendingCount++;
      }

      results.push({
        reviewId: review.id,
        reviewer: review.reviewer.name,
        rating: review.rating,
        comment: review.comment,
        reply,
        posted: shouldPost,
        needsApproval: !isPositive,
      });
    } catch (err) {
      console.error(`Auto-reply failed for review ${review.id}:`, err);
      results.push({
        reviewId: review.id,
        reviewer: review.reviewer.name,
        rating: review.rating,
        comment: review.comment,
        error: "Failed to generate/post reply",
        posted: false,
        needsApproval: false,
      });
    }
  }

  return NextResponse.json({ total: unreplied.length, posted: postedCount, pending: pendingCount, results });
}
