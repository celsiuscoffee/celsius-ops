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
};

type PosterSuggestion = {
  tintColor: string;     // "#RRGGBB"
  tintOpacity: number;   // 0.0 - 0.6
  headline: TextLayerSuggestion;
  subheads: TextLayerSuggestion[]; // 1-3 items
};

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

PICKING THE HEADLINE — this is the single most important call. The headline is the BIGGEST, MOST PROMINENT line on the poster. It must be the one thing a customer would understand in a 1-second glance.

  • If the objective mentions a promo, discount, freebie or specific offer (e.g. "10% off espresso", "Buy 1 Get 1 free", "Free pastry weekend"), THAT is the headline. Don't bury it in a subhead and use a vague tagline ("Iftar Special") as the headline.
  • Examples — what to put where:
      Objective: "Promote Ramadan iftar with 20% off espresso"
      → headline: "20% off espresso"   (the offer — the punchy ask)
      → subhead 1: "Iftar special, this Ramadan"   (the context)
      → subhead 2 (optional): "Today only · Tap to claim"   (CTA / urgency)
  • If there is no specific offer, the headline is the campaign theme in 2-4 punchy words ("Slow down.", "Holiday brews", "New menu").
  • Headlines under 5 words. Punctuation OK (a period or hyphen can land harder than nothing). Reserve "!" for genuine hype that the objective explicitly calls for.

BRAND POSTER LOOK — Celsius posters use this typography pattern:
  • Headline: Peachi (serif), heavy weight, often broken into two short lines for a "rhythm" feel ("Slow down. / Coffee is here."). Light cream/white on dark photos, espresso brown on light photos.
  • Subheads: Peachi medium, shorter and softer. Often muted opacity ('#F5F3F0' or 'rgba(255,255,255,0.7)' style colours).
  • Left-aligned poster copy is the default for the brand. Centre-aligned is fine for splash but feels more generic — prefer left-aligned for home banners unless the bg specifically demands centre composition.
  • Group the text — headline and subheads sit in a stack (close x values, stepped y values), not scattered.

CHOOSING COLOURS — look at the image carefully. Identify low-detail areas (sky, flat surfaces, blurred backgrounds) where text will read clearly. For EACH text layer, choose a colour with strong contrast against the bg AT THAT TEXT'S POSITION (light text on dark areas, dark text on light areas). Brand-coherent picks are #FFFFFF, #F5F3F0 (cream), #160800 (espresso), #C2452D (terracotta), #FBBF24 (amber) — only stray from these if the bg demands it. The tint sits over the entire image and helps unify the look — keep it subtle (opacity 0.15-0.45) unless the image is very busy.

DECIDE HOW MANY SUBHEADS — usually 1 (just a tagline), sometimes 2 (context + CTA), occasionally 3 if the objective is dense. Don't pad. Each subhead should earn its place.

BRAND VOICE — warm, casual, Malaysian English. Headline 2-4 words, punchy. Each subhead 3-10 words. No emojis.

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
  "subheads": [
    {
      "text": "string",
      "x": 0.0-1.0,
      "y": 0.0-1.0,
      "color": "#RRGGBB",
      "size": 0.025-0.06,
      "align": "left" | "center" | "right"
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
        text:  String(r.text ?? "").slice(0, 140),
        x:     clamp(r.x, 0, 1, 0.5),
        y:     clamp(r.y, 0, 1, 0.55 + idx * 0.07),
        color: hex(r.color, "#F5F3F0"),
        size:  clamp(r.size, 0.02, 0.08, 0.04),
        align: align(r.align, "center"),
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
        text:  String(parsed.headline?.text ?? "").slice(0, 60),
        x:     clamp(parsed.headline?.x, 0, 1, 0.5),
        y:     clamp(parsed.headline?.y, 0, 1, 0.4),
        color: hex(parsed.headline?.color, "#FFFFFF"),
        size:  clamp(parsed.headline?.size, 0.04, 0.2, 0.1),
        align: align(parsed.headline?.align, "center"),
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
