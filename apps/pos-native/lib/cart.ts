import { create } from "zustand";
import type { Product, ModifierOption } from "./menu";

/**
 * In-memory cart for the active sale. The store itself is NOT auto-persisted —
 * a relaunch starts blank. Crash/hang recovery is handled separately by
 * lib/draft-order.ts, which keeps a durable, time-boxed copy and lets the
 * register OFFER to resume it (via replaceLines) — so a stale basket is never
 * silently resurrected. One line per product+modifier combination; same combo
 * bumps quantity.
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
  /** Change an existing line's modifier selection. Recomputes the line key +
   *  unit price (product + new modifier prices) while keeping its qty,
   *  discount, note and takeaway. If the new product+modifier combo already
   *  exists as another line, the two merge (qty added), mirroring add(). */
  setLineModifiers: (key: string, modifiers: ModifierOption[]) => void;
  /** Replace the whole basket at once — used to restore a recovered draft order
   *  on relaunch (lib/draft-order.ts). */
  replaceLines: (lines: CartLine[]) => void;
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
  setLineModifiers: (key, modifiers) =>
    set((s) => {
      const idx = s.lines.findIndex((l) => l.key === key);
      if (idx < 0) return s;
      const l = s.lines[idx];
      const newKey = lineKey(l.product.id, modifiers);
      if (newKey === key) return s; // nothing changed
      const unit_sen = l.product.price_sen + modifiers.reduce((sum, m) => sum + m.price_sen, 0);
      const dupIdx = s.lines.findIndex((x, i) => i !== idx && x.key === newKey);
      const lines = s.lines.slice();
      if (dupIdx >= 0) {
        // The edited combo already exists → merge quantities, drop this line.
        lines[dupIdx] = { ...lines[dupIdx], qty: lines[dupIdx].qty + l.qty };
        lines.splice(idx, 1);
      } else {
        lines[idx] = { ...l, key: newKey, modifiers, unit_sen };
      }
      return { lines };
    }),
  replaceLines: (lines) => set({ lines }),
  clear: () => set({ lines: [] }),
}));

/** Subtotal in sen across all lines, net of any per-line discounts. */
export const cartSubtotal = (lines: CartLine[]) =>
  lines.reduce((sum, l) => sum + l.unit_sen * l.qty - (l.line_discount_sen ?? 0), 0);

/** Line total in sen after the per-line discount. Use this for display
 *  and for the value persisted to pos_order_items.item_total. */
export const lineNet = (l: CartLine) =>
  l.unit_sen * l.qty - (l.line_discount_sen ?? 0);
