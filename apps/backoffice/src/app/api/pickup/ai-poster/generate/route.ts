import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type Placement = "splash" | "home";

// Output schema — strict JSON the composer can drop straight into state.
// Positions are normalised (0-1) so they survive resolution changes
// between preview and final rasterise. subheads is an array so the AI
// can propose multiple supporting lines (e.g. detail + CTA).
type TextLayerSuggestion = {
  text: string;
  x: number;           // 0 (left) - 1 (right) — anchor
  y: number;           // 0 (top)  - 1 (bottom) — vertical centre
  color: string;
  size: number;        // headline 0.06-0.16, subhead 0.025-0.06
  align: "left" | "center" | "right";
  shadow?: number;     // 0 (none) - 1 (heavy). Boost when text contrast is weak.
};

type PosterSuggestion = {
  tintColor: string;     // "#RRGGBB"
  tintOpacity: number;   // 0.0 - 0.6
  headline: TextLayerSuggestion;
  subheads: TextLayerSuggestion[]; // 1-3 items
};

// Extract prompt — used when opening the composer on a legacy poster
// that has text baked into the bg image but no saved composer_state.
// Asks Claude to OCR the visible text and return matching layers so the
// operator can edit them instead of re-doing AI compose from scratch.
function buildExtractPrompt(placement: Placement): string {
  const surfaceNote =
    placement === "home"
      ? `Surface: Home carousel banner, ~15:14 aspect.`
      : `Surface: App splash screen, 9:16 portrait.`;

  return `You are reading an existing promotional poster for Celsius Coffee. The image contains text already baked into the pixels (headline + supporting lines). Your job is to OCR that text and return it as editable layers, MATCHING the existing visual composition as closely as possible.

${surfaceNote}

INSTRUCTIONS:
  1. Read every word of visible text in the image. Group them into ONE headline (the largest/most prominent line) and 1-3 subheads (smaller supporting lines). If a line wraps (e.g. "10%" then "OFF" on the next visual line), treat each visual line as a SEPARATE layer.
  2. For EACH text layer, estimate its position (x, y as 0-1 anchor — where the layer's centre would sit), its display size as a fraction of the image height (e.g. very large text ≈ 0.16-0.22, medium ≈ 0.05-0.08, small ≈ 0.025-0.045), its colour (sample the actual ink colour from the image), and alignment (left / center / right based on how the text is laid out).
  3. For the tint, estimate the overall colour bias of any photo-darkening overlay (if any). If the bg image looks untreated, return tintColor "#160800" and tintOpacity 0.
  4. Do NOT invent new text. Only return what you can read. If the image has no readable text, return a single empty headline.

  5. SHADOW — if the visible text already has a drop shadow / outline / glow behind it (lifting it off the bg), set "shadow" to the strength you observe (light shadow ≈ 0.2-0.4, heavy ≈ 0.5-0.8). If the text sits flat on the photo with no shadow, return 0.

Return STRICT JSON only — no prose, no markdown fences:

{
  "tintColor": "#RRGGBB",
  "tintOpacity": 0.0-0.6,
  "headline": {
    "text": "string",
    "x": 0.0-1.0,
    "y": 0.0-1.0,
    "color": "#RRGGBB",
    "size": 0.04-0.24,
    "align": "left" | "center" | "right",
    "shadow": 0.0-1.0
  },
  "subheads": [
    {
      "text": "string",
      "x": 0.0-1.0,
      "y": 0.0-1.0,
      "color": "#RRGGBB",
      "size": 0.02-0.10,
      "align": "left" | "center" | "right",
      "shadow": 0.0-1.0
    }
  ]
}`;
}

function buildPrompt(objective: string, placement: Placement): string {
  // Reserved zones the customer app overlays on top of the poster. Text
  // and key logo elements should give these areas a wide berth so they
  // don't fight with the app chrome.
  const surfaceNote =
    placement === "home"
      ? `Surface: Home carousel banner, ~15:14 aspect (slightly wider than tall). The customer app paints UI ON TOP of this poster — treat these as RESERVED ZONES:
  • TOP-LEFT corner (x < 0.18, y < 0.10) — the Celsius "C" logo (~28×28px) sits here. Avoid placing text or the user's own logo near this area.
  • TOP-RIGHT corner (x > 0.82, y < 0.10) — the white circular cart button sits here.
  • BOTTOM ~25% (y > 0.72) — a dark rounded info card overlays the lower portion (member greeting + points/vouchers card). DO NOT place text here; it will be completely hidden.
Place text in the SAFE BAND between roughly y = 0.12 and y = 0.68.`
      : `Surface: App splash screen, 9:16 portrait. The poster fills the whole screen, but the customer app paints small overlays — treat these as RESERVED ZONES:
  • TOP-RIGHT corner (x > 0.78, y < 0.10) — a small circular dismiss button (countdown + ✕) sits here.
  • BOTTOM ~8% (y > 0.92) — if the poster has a deeplink, the app shows a tiny "TAP TO OPEN" caption here.
Use the rest of the frame freely. Centre of frame (y ≈ 0.35-0.60) is the prime focal area.`;

  return `You are designing a promotional poster for Celsius Coffee, a specialty coffee chain in Malaysia. The user has provided a background image and an objective. Suggest the overlay: tint colour/opacity, a short headline, and 1 to 3 supporting subhead lines — each with its own position, colour, size and alignment that look good against THIS specific image.

Objective from operator:
"""${objective}"""

${surfaceNote}

STEP 1 — READ THE IMAGE FIRST. Before deciding anything else, identify in this specific photo:
  (a) WHERE THE SUBJECT IS — the photographic focal point (a coffee cup, a face, a hand, a product). Note which side of the frame it occupies. Examples: "coffee cups on the RIGHT half", "espresso machine LEFT-CENTRE", "subject CENTRED, full frame".
  (b) WHERE THE CALM AREAS ARE — flat surfaces, blurred bg, sky, plain walls, shadow. These are where text reads cleanly.
  (c) ANY EXISTING TEXT or labels already baked into the bg image (e.g. cup logos, packaging). Treat these as part of the subject — text should NOT overlap them.

STEP 2 — COMPOSE TEXT ON THE CALM SIDE, OPPOSITE THE SUBJECT. This is the most important rule for getting a brand-coherent poster:
  • If the subject is on the RIGHT → place the text stack on the LEFT (anchor x ≈ 0.05-0.12, align: "left").
  • If the subject is on the LEFT → place the text on the RIGHT (anchor x ≈ 0.88-0.95, align: "right").
  • If the subject is CENTRED and fills the frame → use a tint overlay (opacity 0.35-0.55) and place text in the upper or lower third.
  • Text never overlaps the subject. The brand look is "photo on one side, type on the other."

PICKING THE HEADLINE — the headline is the BIGGEST, MOST PROMINENT line. It must be the one thing a customer parses in a 1-second glance.
  • If the objective mentions a promo, discount, or specific offer, THAT is the headline. Don't bury the offer in a subhead.
  • PREFER A 3-LAYER OFFER STACK when the offer is short (1-3 words). Example pattern used by Celsius:
      Objective: "Promote 10% off on first app order"
      → headline:  "10%"           (HUGE — size 0.16-0.20, Peachi-Bold)
      → subhead 1: "OFF"           (medium — size 0.06-0.07, Peachi-Bold, just under the headline)
      → subhead 2: "on your first app order"  (small — size 0.030-0.038, Peachi-Medium)
    All three left-aligned, anchored at the same x, stepped y values close together so they read as ONE composition.
  • If the offer is longer ("Buy 1 Get 1"), use a 2-layer pattern: headline = offer, subhead = context.
  • If there's no offer, headline = campaign theme in 2-4 words ("Slow down.", "Holiday brews"), with a contextual subhead.
  • Headlines under 5 words. No "!" unless the objective explicitly calls for hype.

BRAND POSTER LOOK — Celsius posters use this typography pattern:
  • Headline: Peachi serif, heavy. Light cream/white on dark photos, espresso brown on light photos. Often dramatically large for short offers (size 0.16-0.20).
  • Subheads: Peachi medium, shorter and softer. Tightly stacked under the headline.
  • Left-aligned is the brand default. Centre-aligned reads as generic — only use it when the subject is dead-centre.
  • Group the text — headline and subheads sit in a stack with the SAME x value, stepped y values 0.06-0.10 apart. Never scatter them across the frame.

CHOOSING COLOURS — look at the calm area you'll place text on. For EACH text layer, choose a colour with strong contrast against THAT region of the bg (light text on dark areas, dark text on light areas). Brand-coherent picks: #FFFFFF, #F5F3F0 (cream), #160800 (espresso), #C2452D (terracotta), #FBBF24 (amber). The full-frame tint is subtle (opacity 0.15-0.45) unless the bg is so busy that text needs a darker scrim under it.

SHADOW — each text layer can carry a drop-shadow strength (0-1) that lifts it off the bg. Default to 0 when contrast is already strong (white text on espresso photo, espresso text on cream surface). Set 0.3-0.5 when the bg is pale or busy enough that the text would otherwise feel muddy. Set 0.6-0.8 only when the layer sits directly on a high-detail area you couldn't reposition. Never use shadow as a substitute for picking the right colour — fix the colour first; shadow is the fallback.

DECIDE HOW MANY SUBHEADS — for short offers, ALWAYS use the 3-layer stack (headline + 2 subheads) shown above. For longer headlines, 1 subhead is enough. Don't pad.

BRAND VOICE — warm, casual, Malaysian English. Headline 1-4 words, punchy. Each subhead 1-8 words. No emojis.

Return STRICT JSON only — no prose, no markdown fences:

{
  "tintColor": "#RRGGBB",
  "tintOpacity": 0.0-0.6,
  "headline": {
    "text": "string",
    "x": 0.0-1.0,
    "y": 0.0-1.0,
    "color": "#RRGGBB",
    "size": 0.06-0.22,
    "align": "left" | "center" | "right",
    "shadow": 0.0-1.0
  },
  "subheads": [
    {
      "text": "string",
      "x": 0.0-1.0,
      "y": 0.0-1.0,
      "color": "#RRGGBB",
      "size": 0.025-0.08,
      "align": "left" | "center" | "right",
      "shadow": 0.0-1.0
    }
    // ... 1-3 items total
  ]
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
  // "compose" (default) generates a brand-new poster from the objective.
  // "extract" OCRs the existing text in the image and returns it as
  // editable layers — used when the operator opens AI compose on a
  // legacy poster (no composer_state saved) so they can edit the prior
  // text instead of starting from scratch.
  const mode: "compose" | "extract" = body?.mode === "extract" ? "extract" : "compose";

  if (!imageUrl) {
    return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
  }
  if (mode === "compose") {
    if (!objective) {
      return NextResponse.json({ error: "objective required" }, { status: 400 });
    }
    if (objective.length > 600) {
      return NextResponse.json({ error: "objective too long (max 600 chars)" }, { status: 400 });
    }
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
            { type: "text", text: mode === "extract" ? buildExtractPrompt(placement) : buildPrompt(objective, placement) },
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

    // Normalise subheads. Falls back to a single subhead if the model
    // returned the old "subhead" key. Capped at 3 — the layer tab UI
    // starts to feel crowded beyond that.
    const parsedAny = parsed as unknown as {
      subheads?: unknown;
      subhead?: Partial<TextLayerSuggestion>;
    };
    const rawSubheads: unknown[] = Array.isArray(parsedAny.subheads)
      ? parsedAny.subheads
      : parsedAny.subhead
        ? [parsedAny.subhead]
        : [];

    const normaliseSub = (raw: unknown, idx: number): TextLayerSuggestion => {
      const r = (raw ?? {}) as Partial<TextLayerSuggestion>;
      return {
        text:   String(r.text ?? "").slice(0, 140),
        x:      clamp(r.x, 0, 1, 0.5),
        y:      clamp(r.y, 0, 1, 0.55 + idx * 0.07),
        color:  hex(r.color, "#F5F3F0"),
        size:   clamp(r.size, 0.02, 0.10, 0.04),
        align:  align(r.align, "center"),
        shadow: clamp(r.shadow, 0, 1, 0),
      };
    };

    const subheads = rawSubheads
      .slice(0, 3)
      .map(normaliseSub)
      .filter((s) => s.text.length > 0);

    const out: PosterSuggestion = {
      tintColor:   hex(parsed.tintColor, "#160800"),
      tintOpacity: clamp(parsed.tintOpacity, 0, 0.7, 0.25),
      headline: {
        text:   String(parsed.headline?.text ?? "").slice(0, 60),
        x:      clamp(parsed.headline?.x, 0, 1, 0.5),
        y:      clamp(parsed.headline?.y, 0, 1, 0.4),
        color:  hex(parsed.headline?.color, "#FFFFFF"),
        size:   clamp(parsed.headline?.size, 0.04, 0.24, 0.1),
        align:  align(parsed.headline?.align, "center"),
        shadow: clamp(parsed.headline?.shadow, 0, 1, 0),
      },
      // Guarantee at least one subhead so the composer always has
      // something to drag / re-style.
      subheads: subheads.length > 0
        ? subheads
        : [normaliseSub({ text: "" }, 0)],
    };

    return NextResponse.json({ suggestion: out });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
