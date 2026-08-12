/**
 * Turn a sold line into the ingredients it actually consumed.
 *
 * A menu's recipe is not a flat list. Three things scope a line, and every
 * consumer that ignores them gets a different wrong answer:
 *
 *   serviceMode — ALL, or only DINE_IN / TAKEAWAY (the takeaway cup).
 *   modifier    — null applies always; "Hot"/"Iced" scope the line to that
 *                 temperature, so a recipe can carry both doses without
 *                 duplicating itself. 33 lines across 15 drinks do exactly this.
 *   replacesProductId — the line stands IN PLACE OF another product rather than
 *                 adding to it. Oat milk replaces fresh milk; without this the
 *                 drink is billed for both.
 *
 * The variance report read none of them: it summed every row for a menu, so a
 * Caramel Latte was charged 17ml Iced + 8ml Hot = 25ml on every single sale,
 * roughly double, and oat-milk drinks were charged fresh milk they never used.
 *
 * `modifier` matches `pos_order_items.modifiers[].name` verbatim, which is what
 * makes this expansion possible at all — the POS records "Iced", "Hot",
 * "Oatmilk", "Extra Shot" per line, so the recipe can be scoped by the same key.
 */

export interface RecipeLine {
  productId: string;
  /** Quantity in the product's BASE UOM. The `uom` column is descriptive only. */
  quantityUsed: number | string;
  serviceMode?: "ALL" | "DINE_IN" | "TAKEAWAY" | null;
  /** Modifier this line is scoped to. null = applies to every sale. */
  modifier?: string | null;
  /** When set, this line replaces that product's lines instead of adding. */
  replacesProductId?: string | null;
}

export interface SoldLine {
  /** Units sold, already net of refunds. */
  units: number;
  /**
   * Modifier names on the line. Pass the raw column and it is normalised —
   * the two sales channels store the same vocabulary in different shapes.
   */
  modifiers?: string[] | unknown;
  /** Fulfilment channel, when known — gates DINE_IN / TAKEAWAY lines. */
  serviceMode?: "DINE_IN" | "TAKEAWAY" | null;
}

/**
 * Read modifier names off a sold line, whichever channel wrote it.
 *
 * Sales arrive from three channels in two tables, and the same modifier is
 * stored two different ways:
 *
 *   pos_order_items.modifiers  (POS counter + GrabFood)
 *     [{ "name": "Iced" }, { "name": "Oatmilk" }]
 *
 *   order_items.modifiers      (customer app: table-QR dine-in + pickup)
 *     { "selections": [{ "label": "Iced", "groupName": "Temperature" }],
 *       "specialInstructions": "less ice" }
 *
 * The vocabulary is identical — Iced, Hot, Oatmilk, Extra Shot, Extra Syrup —
 * but code written against one shape silently reads nothing from the other, and
 * "nothing" is indistinguishable from "no modifiers chosen". That is not a
 * small error: table-QR dine-in alone is 12–20% of ingredient demand, and a
 * temperature-scoped recipe line simply never fires for it, so every iced/hot
 * dose on those sales goes uncounted.
 *
 * `specialInstructions` is deliberately ignored. It is free text — "less
 * sweet", "no sugar", "takeaway cup" — not a modifier, and guessing intent from
 * it would put made-up numbers into a costing.
 */
export function normaliseModifiers(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];

  // Already normalised.
  if (Array.isArray(raw)) {
    return raw
      .map((m) => {
        if (typeof m === "string") return m;
        if (m && typeof m === "object") {
          const o = m as Record<string, unknown>;
          // POS uses `name`; tolerate `label` in case an array-shaped payload
          // ever carries the app's key.
          const v = o.name ?? o.label;
          return typeof v === "string" ? v : null;
        }
        return null;
      })
      .filter((s): s is string => !!s);
  }

  // Customer-app object shape.
  if (typeof raw === "object") {
    const sel = (raw as Record<string, unknown>).selections;
    if (Array.isArray(sel)) {
      return sel
        .map((s) => {
          if (typeof s === "string") return s;
          if (s && typeof s === "object") {
            const o = s as Record<string, unknown>;
            const v = o.label ?? o.name;
            return typeof v === "string" ? v : null;
          }
          return null;
        })
        .filter((s): s is string => !!s);
    }
  }

  return [];
}

function toNum(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ingredient quantities (base UOM) consumed by one sold line.
 *
 * Resolution order matters: scope first, then substitute. A replacement only
 * displaces the ingredient it names, and only when its own modifier is present
 * — so an oat Caramel Latte still gets its Iced syrup dose, and still loses its
 * fresh milk.
 */
export function expandSoldLine(
  line: SoldLine,
  recipe: RecipeLine[],
): Map<string, number> {
  const mods = new Set(normaliseModifiers(line.modifiers));

  // 1. Keep only lines whose scope this sale satisfies.
  const inScope = recipe.filter((r) => {
    const sm = r.serviceMode ?? "ALL";
    if (sm !== "ALL" && line.serviceMode && sm !== line.serviceMode) return false;
    // A channel-scoped line with an unknown channel is kept: dropping it would
    // silently under-count packaging on every sale we can't classify.
    if (r.modifier && !mods.has(r.modifier)) return false;
    return true;
  });

  // 2. Any in-scope line that declares a replacement suppresses the product it
  //    names. Collected before summing so order within the recipe never matters.
  const replaced = new Set<string>();
  for (const r of inScope) {
    if (r.replacesProductId) replaced.add(r.replacesProductId);
  }

  const out = new Map<string, number>();
  for (const r of inScope) {
    if (replaced.has(r.productId)) continue; // displaced by a substitution
    const qty = toNum(r.quantityUsed) * line.units;
    if (qty === 0) continue;
    out.set(r.productId, (out.get(r.productId) ?? 0) + qty);
  }
  return out;
}

/** Sum expanded ingredient usage across many sold lines. */
export function expandSoldLines(
  lines: Array<SoldLine & { recipe: RecipeLine[] }>,
): Map<string, number> {
  const total = new Map<string, number>();
  for (const l of lines) {
    for (const [productId, qty] of expandSoldLine(l, l.recipe)) {
      total.set(productId, (total.get(productId) ?? 0) + qty);
    }
  }
  return total;
}
