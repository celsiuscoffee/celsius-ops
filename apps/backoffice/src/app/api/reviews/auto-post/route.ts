import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getUserFromHeaders } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLocalPost, listLocalPosts } from "@/lib/reviews/gbp";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const POST_TYPES = [
  "menu_highlight",
  "ambiance",
  "promo",
  "behind_scenes",
  "community",
  "seasonal",
  "tip",
] as const;

type PostType = (typeof POST_TYPES)[number];

const POST_TYPE_PROMPTS: Record<PostType, string> = {
  menu_highlight:
    "Highlight a specific drink or food item. Describe its taste, ingredients, or what makes it special. Make people crave it.",
  ambiance:
    "Describe the cafe ambiance — the vibe, seating, study-friendly environment, or aesthetic. Make people want to visit.",
  promo:
    "Create an engaging update about visiting Celsius Coffee. Could be about new items, happy hour, or a reason to drop by today.",
  behind_scenes:
    "Share a behind-the-scenes moment — barista craft, fresh ingredients, morning prep, or attention to quality.",
  community:
    "Highlight the community aspect — students studying, friends catching up, regulars, or the neighborhood feel.",
  seasonal:
    "Create a post tied to the current season, weather, or time of year. Rainy day coffee, morning pick-me-up, weekend chill, etc.",
  tip:
    "Share a quick coffee tip, fun fact, or food pairing suggestion that positions Celsius as knowledgeable and passionate about coffee.",
};

async function generatePost(outletName: string, postType: PostType): Promise<string> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are the social media manager for ${outletName}, a specialty coffee brand in Malaysia. Write a short Google Business Profile post (max 300 characters).

Style: Casual, warm, inviting. Write like a friendly local cafe, not a corporate brand. Use 1-2 emojis max. No hashtags.

Topic: ${POST_TYPE_PROMPTS[postType]}

Write only the post text, nothing else.`,
      },
    ],
  });

  const text = response.content[0];
  return text.type === "text" ? text.text.trim() : "";
}

// POST /api/reviews/auto-post
// Body: { outletId, postType?: string, customText?: string, mode: "preview" | "post" }
export async function POST(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { outletId, postType, customText, mode = "preview" } = await request.json();
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const settings = await prisma.reviewSettings.findUnique({
    where: { outletId },
    include: { outlet: { select: { name: true } } },
  });
  if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
    return NextResponse.json({ error: "GBP not connected" }, { status: 400 });
  }

  const outletName = settings.outlet.name;

  // Generate or use custom text
  const selectedType = (postType && POST_TYPES.includes(postType as PostType))
    ? postType as PostType
    : POST_TYPES[Math.floor(Math.random() * POST_TYPES.length)];

  const postText = customText || await generatePost(outletName, selectedType);

  if (mode === "post") {
    const result = await createLocalPost(
      settings.gbpAccountId,
      settings.gbpLocationName,
      postText,
    );
    return NextResponse.json({ posted: true, postType: selectedType, text: postText, gbpPost: result });
  }

  return NextResponse.json({ posted: false, postType: selectedType, text: postText });
}

// GET /api/reviews/auto-post?outletId=xxx — list recent posts
export async function GET(request: NextRequest) {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const outletId = request.nextUrl.searchParams.get("outletId");
  if (!outletId) return NextResponse.json({ error: "outletId required" }, { status: 400 });

  const settings = await prisma.reviewSettings.findUnique({ where: { outletId } });
  if (!settings?.gbpAccountId || !settings?.gbpLocationName) {
    return NextResponse.json({ error: "GBP not connected", posts: [] }, { status: 400 });
  }

  try {
    const data = await listLocalPosts(settings.gbpAccountId, settings.gbpLocationName, 10);
    return NextResponse.json(data);
  } catch (err) {
    console.error("GBP list posts error:", err);
    return NextResponse.json({ posts: [], error: "Failed to fetch posts" }, { status: 502 });
  }
}
