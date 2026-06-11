/**
 * Sunmi native printer — uses Capacitor plugin to talk to the Sunmi AIDL service.
 * Only works inside the Capacitor Android app.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { OrderRow, OrderItemRow } from "@/lib/supabase/types";

type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

const STORE_NAMES: Record<string, string> = {
  "shah-alam": "Shah Alam",
  "conezion": "Putrajaya",
  "tamarind": "Tamarind Square",
  "putrajaya": "Celsius Coffee Putrajaya",
};

function getPlugin(): any | null {
  try {
    // Capacitor registers plugins on window.Capacitor.Plugins
    return (window as any).Capacitor?.Plugins?.SunmiPrinter ?? null;
  } catch {
    return null;
  }
}

export function isCapacitorNative(): boolean {
  try {
    return (window as any).Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export async function isSunmiReady(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.isReady();
    return result?.ready === true;
  } catch {
    return false;
  }
}

function formatItems(items: OrderItemRow[]): string {
  return items.map((item) => {
    const mods = (item.modifiers?.selections ?? []).map((s) => s.label).join(", ");
    const note = item.modifiers?.specialInstructions;
    let line = `${item.quantity}x ${item.product_name}`;
    if (mods) line += `\n  ${mods}`;
    if (note) line += `\n  * ${note}`;
    return line;
  }).join("\n");
}

function fmt(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

export async function nativePrintKitchenSlip(order: OrderWithItems): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;

  const store = STORE_NAMES[order.store_id] ?? order.store_id.replace(/-/g, " ");
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  try {
    await plugin.printReceipt({
      type: "kitchen",
      orderNumber: order.order_number,
      storeName: store,
      time,
      items: formatItems(order.order_items),
      notes: order.notes ?? "",
      total: fmt(order.total),
      subtotal: fmt(order.subtotal),
      payment: (order.payment_method ?? "").toUpperCase().replace(/_/g, " "),
    });
    return true;
  } catch (e) {
    console.error("Native print error:", e);
    return false;
  }
}

export async function nativePrintReceipt(order: OrderWithItems): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin) return false;

  const store = STORE_NAMES[order.store_id] ?? order.store_id.replace(/-/g, " ");
  const time = new Date(order.created_at).toLocaleTimeString("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  });

  try {
    await plugin.printReceipt({
      type: "receipt",
      orderNumber: order.order_number,
      storeName: store,
      time,
      items: formatItems(order.order_items),
      notes: order.notes ?? "",
      total: fmt(order.total),
      subtotal: fmt(order.subtotal),
      payment: (order.payment_method ?? "").toUpperCase().replace(/_/g, " "),
    });
    return true;
  } catch (e) {
    console.error("Native print error:", e);
    return false;
  }
}
