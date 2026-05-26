/**
 * Live bridge between POS Register and Customer Display.
 *
 * Uses Supabase Realtime (server-mediated broadcast) instead of
 * BroadcastChannel. The BroadcastChannel API only works between tabs
 * in the same browser process — that's fine for a developer testing
 * with two Chrome tabs, but the SUNMI D3 POS hardware runs each
 * physical display as its own WebView, and those WebViews are separate
 * processes. BroadcastChannel messages would never cross.
 *
 * Realtime channels are 50-200ms over the network, which feels live
 * enough for the cashier ↔ customer screen, and they work between any
 * two clients on any device.
 *
 *   Register → Display: cart + member + voucher state on every change
 *   Display → Register: loyalty actions (memberSelected, applyVoucher,
 *                       applyShopReward, addToCart, memberCleared)
 *
 * Both directions share one channel name (`pos-cart-bridge`) with two
 * different event names so a side never echoes its own messages.
 *
 * Fallback: also broadcasts via the old BroadcastChannel when available
 * so same-process tabs get instant updates (Realtime adds ~100ms
 * latency that doesn't matter for cross-display but is noticeable when
 * everything's in one browser).
 */

import { createBrowserClient } from "@supabase/ssr";

export type CustomerDisplayData = {
  items: {
    /** product id — broadcast so the customer-display can hit the
     *  co-purchase RPC ("what do customers buy alongside THIS
     *  product?") and ground Pair-with-a-bite in real basket data. */
    productId?: string;
    name: string;
    qty: number;
    amount: number;
    modifiers?: string;
  }[];
  subtotal: number;
  serviceCharge: number;
  discount: number;
  total: number;
  outletId: string;
  outletName: string;
  status: "idle" | "ordering" | "payment" | "complete";
  orderNumber?: string;
  paymentMethod?: string;
  // Live member context surfaced to the second screen so it can show a
  // "Member: …" pill + applied-voucher badge while a cart is open.
  member?: {
    id: string;
    name: string | null;
    phone: string;
    points_balance: number;
  } | null;
  appliedVoucher?: {
    id: string;
    name: string;
    discount_sen: number;
  } | null;
  // Itemized auto-promotions (tier % off, happy hour, etc.) so the
  // second screen can list each saving by name instead of folding them
  // into one anonymous "Discount" line. Empty when no promos apply.
  autoPromotions?: Array<{
    id: string;
    name: string;
    discount_sen: number;
  }>;
};

export type RegisterInboxMessage =
  | {
      type: "memberSelected";
      member: {
        id: string;
        name: string | null;
        phone: string;
        tags: string[];
        points_balance: number;
        total_spent: number;
        total_visits: number;
        last_visit_at: string | null;
        tier?: {
          id: string;
          slug: string;
          name: string;
          color: string;
          multiplier: number;
          // Native stacking rules — exposed so the register can decide
          // whether a voucher can stack with the tier discount or not.
          discount_percent: number;
          stackable: boolean;
        } | null;
      };
    }
  | {
      type: "memberCleared";
    }
  | {
      type: "applyVoucher";
      memberId: string;
      voucherId: string;
      voucherName: string;
      discount: {
        type: string;
        value: number;
        max_discount: number | null;
        min_order: number | null;
        applicable_products: string[] | null;
        applicable_categories: string[] | null;
        free_product_ids: string[] | null;
        free_product_name: string | null;
      };
    }
  // One-tap reorder: customer taps a tile in the "Your usual" strip on
  // the second screen and the register adds the product to cart. We
  // pass productId only — register looks up the live product so it has
  // the current price + modifier definitions. If the product has
  // modifiers the cashier still needs to confirm them (a regular's
  // "usual" doesn't tell us their modifier combo), but the item lands
  // in cart with no modifiers selected which is a sensible default.
  | {
      type: "addToCart";
      productId: string;
      productName: string;
    }
  // Deferred Spend Beans — customer taps a "Spend X Beans" tile on
  // the second screen. We carry the discount shape across the channel
  // so the register can apply the cart discount immediately, but the
  // actual Beans burn happens at checkout commit (the register calls
  // /api/loyalty/redeem in handleCheckoutComplete). If the cart is
  // voided before checkout, nothing is burned — the redemption is
  // purely client-side until the order lands.
  | {
      type: "applyShopReward";
      memberId: string;
      rewardId: string;
      rewardName: string;
      pointsCost: number;
      discount: {
        type: string;
        value: number;
        max_discount: number | null;
        min_order: number | null;
        applicable_products: string[] | null;
        applicable_categories: string[] | null;
        free_product_ids: string[] | null;
        free_product_name: string | null;
      };
    };

// ── Single shared Realtime channel ────────────────────────────────
// One channel name shared by both directions; the event name keeps
// them apart. Single-channel keeps the Realtime connection count
// down — we'd otherwise need two presence sockets per tab.
const REALTIME_CHANNEL = "pos-cart-bridge";
const EVT_DISPLAY = "display-data";       // register → display
const EVT_REGISTER = "register-inbox";    // display → register

// Lazily-initialised browser supabase client. Created on first
// broadcast / subscribe — running outside the browser (SSR) is a
// no-op since BroadcastChannel + Realtime are both client-only.
let supabaseSingleton: ReturnType<typeof createBrowserClient> | null = null;
function getSupabase() {
  if (typeof window === "undefined") return null;
  if (supabaseSingleton) return supabaseSingleton;
  supabaseSingleton = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return supabaseSingleton;
}

// One subscribed channel per tab. Re-used for both directions so we
// don't open a new socket per broadcast. Subscribed lazily on first
// listenTo* call AND first send*; broadcast() requires SUBSCRIBED
// state to deliver.
//
// Reconnect contract: if the WebSocket drops (CLOSED, CHANNEL_ERROR,
// TIMED_OUT — which fires when the browser backgrounds the tab, the
// network blips, or Supabase rotates the realtime server), we tear
// the channel down and clear `channelPromise` so the NEXT call to
// getChannel() re-subscribes from scratch. We also schedule a small
// keepalive that re-resolves the promise within ~2s of disconnect
// so passive listeners (which only call getChannel() once on mount)
// don't sit forever on a dead socket.
//
// Without this, the customer-display would silently stop receiving
// cart updates after the first tab background or network blip and
// look "disconnected" — register keeps broadcasting but messages
// arrive on a closed channel.

type SbChannel = ReturnType<NonNullable<ReturnType<typeof getSupabase>>["channel"]>;
let channelPromise: Promise<SbChannel> | null = null;
let currentChannel: SbChannel | null = null;
// Handlers registered via `ch.on()` need to be re-attached after a
// reconnect because the underlying channel object is brand new.
// We track them here and replay on every fresh subscribe.
type ListenerEntry = { event: string; handler: (msg: { payload?: unknown }) => void };
const pendingListeners: ListenerEntry[] = [];

function buildChannel(sb: NonNullable<ReturnType<typeof getSupabase>>): Promise<SbChannel> {
  const ch = sb.channel(REALTIME_CHANNEL, {
    config: {
      // self: true → broadcasts also fire on our own listener. We
      // already dedupe by event name (display sends `register-inbox`,
      // listens to `display-data` — no overlap), so this is safe and
      // it lets a single-tab dev test (both register + display in
      // one tab via debug) work too.
      broadcast: { self: true, ack: false },
    },
  });

  // Replay registered listeners onto the new channel before we
  // subscribe — otherwise a reconnect would resubscribe an empty
  // channel and nothing would land in the listener callbacks.
  for (const { event, handler } of pendingListeners) {
    ch.on("broadcast", { event }, handler);
  }

  currentChannel = ch;
  return new Promise((resolve) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        resolve(ch);
        return;
      }
      // Disconnect path — torn down by server, network, or browser
      // throttling. Drop the cached promise so the next consumer
      // builds a fresh channel. A small backoff prevents a tight
      // reconnect loop if the server is unreachable.
      if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        if (currentChannel === ch) {
          currentChannel = null;
          channelPromise = null;
        }
        try {
          void sb.removeChannel(ch);
        } catch {
          /* already gone */
        }
        // Re-arm the connection after a short delay. We don't await
        // anything here — broadcastToCustomerDisplay / sendToRegister
        // will lazily resolve the next channelPromise when they fire.
        setTimeout(() => {
          if (!channelPromise) {
            channelPromise = buildChannel(sb);
          }
        }, 1500);
      }
    });
  });
}

function getChannel() {
  const sb = getSupabase();
  if (!sb) return null;
  if (channelPromise) return channelPromise;
  channelPromise = buildChannel(sb);
  return channelPromise;
}

// Browsers that don't support BroadcastChannel (rare these days) just
// rely on Realtime. We still try to use BroadcastChannel when present
// because it's instantaneous for the same-process case (developer
// dual-tab testing); Realtime adds ~100ms that's invisible across
// devices but feels laggy if both screens are on one laptop.
function tryBroadcastChannel(name: string, msg: unknown): boolean {
  try {
    if (typeof BroadcastChannel === "undefined") return false;
    const ch = new BroadcastChannel(name);
    ch.postMessage(msg);
    ch.close();
    return true;
  } catch {
    return false;
  }
}

function tryListenBroadcastChannel<T>(
  name: string,
  cb: (msg: T) => void,
): (() => void) | null {
  try {
    if (typeof BroadcastChannel === "undefined") return null;
    const ch = new BroadcastChannel(name);
    ch.onmessage = (e) => cb(e.data as T);
    return () => ch.close();
  } catch {
    return null;
  }
}

export function broadcastToCustomerDisplay(data: CustomerDisplayData) {
  // Primary: Realtime (works cross-device)
  void getChannel()?.then((ch) => {
    ch.send({ type: "broadcast", event: EVT_DISPLAY, payload: data });
  });
  // Bonus: BroadcastChannel (instant for same-process tabs)
  tryBroadcastChannel("celsius-customer-display", data);
}

export function listenToCustomerDisplay(
  callback: (data: CustomerDisplayData) => void,
): () => void {
  const bcCleanup = tryListenBroadcastChannel<CustomerDisplayData>(
    "celsius-customer-display",
    callback,
  );

  const handler = (msg: { payload?: unknown }) => {
    if (msg.payload) callback(msg.payload as CustomerDisplayData);
  };
  // Register in the replay list so reconnects re-attach this handler
  // onto the fresh channel. Without this, the handler only sticks to
  // the FIRST channel object and a single network blip would silently
  // detach the listener forever.
  pendingListeners.push({ event: EVT_DISPLAY, handler });

  void getChannel()?.then((ch) => {
    ch.on("broadcast", { event: EVT_DISPLAY }, handler);
  });

  return () => {
    bcCleanup?.();
    // findIndex (not `indexOf(find(...))`) — the previous form could
    // misbehave because indexOf does reference equality, and if
    // listenToX was called twice (StrictMode dev double-mount,
    // re-subscription on reconnect), two distinct ListenerEntry
    // objects with the SAME handler get pushed. find() returns the
    // first, indexOf returns that index OR -1 if reference lost —
    // either way only one entry was removed per cleanup, so
    // duplicate handlers leaked and fired multiple times per
    // message. findIndex with handler-identity match is correct +
    // unambiguous: it removes the first matching entry by predicate.
    const i = pendingListeners.findIndex((l) => l.handler === handler);
    if (i >= 0) pendingListeners.splice(i, 1);
  };
}

export function sendToRegister(msg: RegisterInboxMessage) {
  void getChannel()?.then((ch) => {
    ch.send({ type: "broadcast", event: EVT_REGISTER, payload: msg });
  });
  tryBroadcastChannel("celsius-register-inbox", msg);
}

export function listenToRegisterInbox(
  callback: (msg: RegisterInboxMessage) => void,
): () => void {
  const bcCleanup = tryListenBroadcastChannel<RegisterInboxMessage>(
    "celsius-register-inbox",
    callback,
  );

  const handler = (msg: { payload?: unknown }) => {
    if (msg.payload) callback(msg.payload as RegisterInboxMessage);
  };
  pendingListeners.push({ event: EVT_REGISTER, handler });

  void getChannel()?.then((ch) => {
    ch.on("broadcast", { event: EVT_REGISTER }, handler);
  });

  return () => {
    bcCleanup?.();
    // findIndex (not `indexOf(find(...))`) — the previous form could
    // misbehave because indexOf does reference equality, and if
    // listenToX was called twice (StrictMode dev double-mount,
    // re-subscription on reconnect), two distinct ListenerEntry
    // objects with the SAME handler get pushed. find() returns the
    // first, indexOf returns that index OR -1 if reference lost —
    // either way only one entry was removed per cleanup, so
    // duplicate handlers leaked and fired multiple times per
    // message. findIndex with handler-identity match is correct +
    // unambiguous: it removes the first matching entry by predicate.
    const i = pendingListeners.findIndex((l) => l.handler === handler);
    if (i >= 0) pendingListeners.splice(i, 1);
  };
}
