import { create } from "zustand";
import type { Product, ModifierOption } from "./menu";

/**
 * In-memory cart for the active sale. Deliberately NOT persisted — a
 * relaunch must never resurrect a stale basket. One line per
 * product+modifier combination; same combo bumps quantity.
 */
export type CartLine = {
  key: string; // product id + sorted modifier ids
  product: Product;
  qty: number;
  modifiers: ModifierOption[];
  unit_sen: number; // product price + modifier prices, per unit
  // Per-line manual discount in sen (applies to the WHOLE line total,
  // not per-unit). Folded into the line's item_total when persisted to
  // pos_order_items.discount_amount on checkout, so reporting can split
  // line-level vs order-level promos.
  line_discount_sen?: number;
  // Per-item kitchen note (e.g. "no sugar", "extra hot"). Persisted to
  // pos_order_items.notes and printed under the item on the kitchen docket
  // — the per-product replacement for the old single order-wide note.
  note?: string;
  // Per-line fulfilment override: true = pack this item to-go even on a
  // dine-in order. Lets one bill mix dine-in + takeaway. The EFFECTIVE
  // fulfilment is resolved at checkout (a takeaway order forces every line
  // to-go); this flag is the dine-in-order exception. Drives the kitchen
  // docket tag + pos_order_items.fulfillment.
  takeaway?: boolean;
};

type CartState = {
  lines: CartLine[];
  add: (product: Product, modifiers?: ModifierOption[]) => void;
  inc: (key: string) => void;
  dec: (key: string) => void;
  remove: (key: string) => void;
  /** Set a fixed-amount line discount in sen. Clamped to the line's
   *  current subtotal (qty × unit_sen) so we never go negative. Pass 0
   *  or omit to clear. */
  setLineDiscount: (key: string, sen: number) => void;
  /** Set the per-item kitchen note. Trimmed; empty clears it. */
  setLineNote: (key: string, note: string) => void;
  /** Flip a line's fulfilment override (true = pack to-go on a dine-in order). */
  setLineTakeaway: (key: string, takeaway: boolean) => void;
  clear: () => void;
};

const lineKey = (productId: string, mods: ModifierOption[]) =>
  productId + "|" + mods.map((m) => m.id).sort().join(",");

export const useCart = create<CartState>((set) => ({
  lines: [],
  add: (product, modifiers = []) =>
    set((s) => {
      const key = lineKey(product.id, modifiers);
      const existing = s.lines.find((l) => l.key === key);
      if (existing) {
        return { lines: s.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) };
      }
      const unit_sen = product.price_sen + modifiers.reduce((sum, m) => sum + m.price_sen, 0);
      return { lines: [...s.lines, { key, product, qty: 1, modifiers, unit_sen }] };
    }),
  inc: (key) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l)) })),
  dec: (key) =>
    set((s) => ({
      lines: s.lines
        .map((l) => (l.key === key ? { ...l, qty: l.qty - 1 } : l))
        .filter((l) => l.qty > 0),
    })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  setLineDiscount: (key, sen) =>
    set((s) => ({
      lines: s.lines.map((l) => {
        if (l.key !== key) return l;
        const ceiling = l.unit_sen * l.qty;
        const clamped = Math.max(0, Math.min(Math.round(sen), ceiling));
        return { ...l, line_discount_sen: clamped > 0 ? clamped : undefined };
      }),
    })),
  setLineNote: (key, note) =>
    set((s) => ({
      lines: s.lines.map((l) => {
        if (l.key !== key) return l;
        const trimmed = note.trim();
        return { ...l, note: trimmed ? trimmed : undefined };
      }),
    })),
  setLineTakeaway: (key, takeaway) =>
    set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, takeaway } : l)) })),
  clear: () => set({ lines: [] }),
}));

/** Subtotal in sen across all lines, net of any per-line discounts. */
export const cartSubtotal = (lines: CartLine[]) =>
  lines.reduce((sum, l) => sum + l.unit_sen * l.qty - (l.line_discount_sen ?? 0), 0);

/** Line total in sen after the per-line discount. Use this for display
 *  and for the value persisted to pos_order_items.item_total. */
export const lineNet = (l: CartLine) =>
  l.unit_sen * l.qty - (l.line_discount_sen ?? 0);
