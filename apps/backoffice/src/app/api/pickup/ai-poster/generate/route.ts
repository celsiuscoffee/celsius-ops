import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Placement = "splash" | "home";

// Output schema — strict JSON the composer can drop straight into state.
// Positions are normalised (0-1) so they survive resolution changes
// between preview and final rasterise.
type PosterSuggestion = {
  tintColor: string;     // "#RRGGBB"
  tintOpacity: number;   // 0.0 - 0.6
  headline: {
    text: string;
    x: number;           // 0 (left) - 1 (right) — center anchor
    y: number;           // 0 (top)  - 1 (bottom)
    color: string;
    size: number;        // 0.06 - 0.16 of frame height
    align: "left" | "center" | "right";
  };
  subhead: {
    text: string;
    x: number;
    y: number;
    color: string;
    size: number;        // 0.025 - 0.06
    align: "left" | "center" | "right";
  };
};

function buildPrompt(objective: string, placement: Placement): string {
  const surfaceNote =
    placement === "home"
      ? "Surface: Home carousel banner, ~15:14 aspect (slightly wider than tall). The bottom 25% of the image is covered by a small dark info card (member greeting + points/vouchers) — KEEP TEXT CLEAR of y > 0.72."
      : "Surface: App splash screen, 9:16 portrait, full-bleed (no overlays). Use the whole frame.";

  return `You are designing a promotional poster for Celsius Coffee, a specialty coffee chain in Malaysia. The user has provided a background image and an objective. Suggest the overlay: tint color/opacity, a short headline, and a one-line subhead — with positions that look good against THIS specific image.

Objective from operator:
"""${objective}"""

${surfaceNote}

Look at the image carefully. Identify low-detail areas (sky, flat surfaces, blurred backgrounds) where text will read clearly. Pick text colors with strong contrast against the chosen position (light text on dark areas, dark text on light areas). The tint sits over the entire image and helps unify the look — keep it subtle (opacity 0.15-0.45) unless the image is very busy.

Brand voice: warm, casual, Malaysian English. Headline 2-4 words, punchy. Subhead 4-10 words. No emojis. No exclamation marks unless the objective explicitly calls for hype.

Return STRICT JSON only — no prose, no markdown fences:

{
  "tintColor": "#RRGGBB",
  "tintOpacity": 0.0-0.6,
  "headline": {
    "text": "string",
    "x": 0.0-1.0,
    "y": 0.0-1.0,
    "color": "#RRGGBB",
    "size": 0.06-0.16,
    "align": "left" | "center" | "right"
  },
  "subhead": {
    "text": "string",
    "x": 0.0-1.0,
    "y": 0.0-1.0,
    "color": "#RRGGBB",
    "size": 0.025-0.06,
    "align": "left" | "center" | "right"
  }
}`;
}

// Fetch the user-supplied bg image and return it as base64 so Claude
// can see it. Capped at ~4 MB to keep the vision payload reasonable —
// posters going through the cropper are already resized to 1440px max.
async function fetchImageAsBase64(
  url: string,
): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  let mediaType: "image/jpeg" | "image/png" | "image/webp";
  if (ct.includes("png")) mediaType = "image/png";
  else if (ct.includes("webp")) mediaType = "image/webp";
  else mediaType = "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 4 * 1024 * 1024) {
    throw new Error("Image too large for vision call (max 4 MB).");
  }
  return { data: buf.toString("base64"), mediaType };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const imageUrl: string | undefined = body?.imageUrl;
  const objective: string = (body?.objective ?? "").toString().trim();
  const placement: Placement = body?.placement === "splash" ? "splash" : "home";

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
  }
  if (!objective) {
    return NextResponse.json({ error: "objective required" }, { status: 400 });
  }
  if (objective.length > 600) {
    return NextResponse.json({ error: "objective too long (max 600 chars)" }, { status: 400 });
  }

  let img: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
  try {
    img = await fetchImageAsBase64(imageUrl);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to load image";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.data },
            },
            { type: "text", text: buildPrompt(objective, placement) },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean) as PosterSuggestion;

    // Light validation + clamping — Claude is mostly well-behaved here
    // but the composer code assumes ranges, so we enforce them.
    const clamp = (n: unknown, lo: number, hi: number, fb: number): number => {
      const v = typeof n === "number" && Number.isFinite(n) ? n : fb;
      return Math.max(lo, Math.min(hi, v));
    };
    const hex = (s: unknown, fb: string): string => {
      if (typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s)) return s;
      return fb;
    };
    const align = (s: unknown, fb: "left" | "center" | "right") => {
      return s === "left" || s === "center" || s === "right" ? s : fb;
    };

    const out: PosterSuggestion = {
      tintColor:   hex(parsed.tintColor, "#160800"),
      tintOpacity: clamp(parsed.tintOpacity, 0, 0.7, 0.25),
      headline: {
        text:  String(parsed.headline?.text ?? "").slice(0, 60),
        x:     clamp(parsed.headline?.x, 0, 1, 0.5),
        y:     clamp(parsed.headline?.y, 0, 1, 0.4),
        color: hex(parsed.headline?.color, "#FFFFFF"),
        size:  clamp(parsed.headline?.size, 0.04, 0.2, 0.1),
        align: align(parsed.headline?.align, "center"),
      },
      subhead: {
        text:  String(parsed.subhead?.text ?? "").slice(0, 140),
        x:     clamp(parsed.subhead?.x, 0, 1, 0.5),
        y:     clamp(parsed.subhead?.y, 0, 1, 0.55),
        color: hex(parsed.subhead?.color, "#F5F3F0"),
        size:  clamp(parsed.subhead?.size, 0.02, 0.08, 0.04),
        align: align(parsed.subhead?.align, "center"),
      },
    };

    return NextResponse.json({ suggestion: out });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
