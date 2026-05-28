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
};

type CartState = {
  lines: CartLine[];
  add: (product: Product, modifiers?: ModifierOption[]) => void;
  inc: (key: string) => void;
  dec: (key: string) => void;
  remove: (key: string) => void;
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
  clear: () => set({ lines: [] }),
}));

/** Subtotal in sen across all lines. */
export const cartSubtotal = (lines: CartLine[]) =>
  lines.reduce((sum, l) => sum + l.unit_sen * l.qty, 0);
