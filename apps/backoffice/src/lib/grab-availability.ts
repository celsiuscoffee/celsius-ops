/**
 * GrabFood item-availability ("86") delivery — retry + reconcile.
 *
 * WHY THIS EXISTS
 * ---------------
 * A cashier long-presses an item on the SUNMI register; `/api/pos/availability`
 * writes `outlet_product_availability` and best-effort pushes the new status to
 * that outlet's Grab merchant. The write always lands (register + pickup app grey
 * the item out instantly via realtime) but the Grab push is a SINGLE fire-and-
 * forget call — and Grab throttles menu-record updates:
 *
 *   PUT /partner/v1/batch/menu → 409
 *   {"reason":"conflict","message":"batchUpdate ITEM <id> too frequently, retry after 10 seconds"}
 *
 * With no retry, a throttled 86 was lost forever: closed on the till, still
 * selling on Grab. (Verified in prod: Mini Pavlova at Shah Alam, 86'd
 * 2026-08-02 12:31:50Z, push 409'd at the same second, and Grab took an order
 * for it 15h later.) Staff 86 items in bursts — several taps a few seconds
 * apart — which is exactly what trips the throttle.
 *
 * THE FIX, IN TWO LAYERS
 *   1. `pushAvailability` — bounded, throttle-aware retry that honours Grab's
 *      own "retry after N seconds" hint. Handles the common burst case inline.
 *   2. `reconcileGrabAvailability` — a safety net on the Grab cron. It diffs the
 *      availability we WANT against a snapshot of what we last successfully
 *      pushed (`app_settings.grab_availability_pushed`) and re-sends only the
 *      difference. Anything the inline push lost self-heals on the next run,
 *      so a lost 86 is bounded by the cron interval instead of forever.
 *
 * The snapshot is deliberately in `app_settings` (JSONB key/value) rather than
 * new columns: no DDL, no migration, and the reconciler is the authority anyway
 * — a missing/stale snapshot just means "push it again", which is idempotent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { batchUpdateMenu, isGrabConfigured } from "@/lib/grab";

/** `app_settings` key holding the last-successfully-pushed availability state. */
export const PUSHED_STATE_KEY = "grab_availability_pushed";

/** merchantId → productId → the availability Grab was last told about. */
export type PushedState = Record<string, Record<string, boolean>>;

export interface AvailabilityEntity {
  id: string;
  availableStatus: "AVAILABLE" | "UNAVAILABLE";
  maxStock?: number;
}

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Grab requires `maxStock: 0` alongside UNAVAILABLE — omitting it leaves the
 * item orderable. Available items leave maxStock unset (absent = in stock).
 * Same convention as `convertProductToGrabItem` in grab-menu.ts.
 */
export function availabilityEntity(productId: string, isAvailable: boolean): AvailabilityEntity {
  return isAvailable
    ? { id: productId, availableStatus: "AVAILABLE" }
    : { id: productId, availableStatus: "UNAVAILABLE", maxStock: 0 };
}

/**
 * True when the error is Grab's menu-record throttle (HTTP 409 "too
 * frequently"). Those are RETRYABLE — the update was rejected, not rejected as
 * invalid. Anything else (400 malformed, 404 unknown item, 401) is permanent
 * and retrying only burns the request budget.
 */
export function isGrabThrottleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("(409)") && /too frequently|conflict/i.test(msg);
}

/**
 * Pull Grab's own advised wait out of the throttle message ("retry after 10
 * seconds") and clamp it to something a request can actually afford. Returns
 * the fallback when Grab didn't say.
 */
export function parseRetryAfterMs(
  err: unknown,
  fallbackMs = 2_000,
  maxMs = 12_000,
): number {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = /retry after (\d+)\s*second/i.exec(msg);
  const ms = m ? Number(m[1]) * 1_000 : fallbackMs;
  return Math.min(Math.max(ms, 0), maxMs);
}

/**
 * An item ships to Grab as UNAVAILABLE when it is either globally off the
 * catalogue or 86'd at this outlet. Mirrors buildOutletGrabMenu's rule so the
 * record push and a full menu push can never disagree.
 */
export function desiredAvailability(
  globallyAvailable: boolean,
  outletUnavailable: boolean,
): boolean {
  return globallyAvailable && !outletUnavailable;
}

/**
 * "Show on" placement: a product ships to Grab when it has no channel allow-list
 * or explicitly lists `grab`. Same rule as buildOutletGrabMenu.
 */
export function isGrabVisible(visibleChannels: unknown): boolean {
  return (
    !Array.isArray(visibleChannels) ||
    visibleChannels.length === 0 ||
    visibleChannels.includes("grab")
  );
}

/**
 * The items whose availability Grab does not (provably) already have: never
 * pushed, or pushed with the opposite status. Sorted for deterministic batches.
 */
export function pendingAvailabilityIds(
  desired: Map<string, boolean>,
  pushed: Record<string, boolean> | undefined,
): string[] {
  const out: string[] = [];
  for (const [productId, want] of desired) {
    if (pushed?.[productId] !== want) out.push(productId);
  }
  return out.sort();
}

/** Split into fixed-size batches so one call can't carry the whole catalogue. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ─── Push with throttle-aware retry ──────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface PushResult {
  ok: boolean;
  attempts: number;
  /** Set when every attempt failed. */
  error?: string;
  /** True when we gave up because Grab kept throttling (reconciler will heal). */
  throttled?: boolean;
}

/**
 * PUT one batch of ITEM records, retrying while Grab reports its throttle.
 *
 * `maxAttempts` is deliberately small and the waits are capped: a cashier is
 * standing at the till, and anything we can't land in a few seconds is better
 * left to `reconcileGrabAvailability` than to a request that hangs.
 */
export async function pushAvailability(
  merchantId: string,
  entities: AvailabilityEntity[],
  opts: { maxAttempts?: number; maxWaitMs?: number } = {},
): Promise<PushResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const maxWaitMs = opts.maxWaitMs ?? 12_000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await batchUpdateMenu(merchantId, "ITEM", entities);
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastErr = err;
      // Permanent failure — a retry would send the identical, still-invalid call.
      if (!isGrabThrottleError(err)) break;
      if (attempt === maxAttempts) break;
      await sleep(parseRetryAfterMs(err, 2_000, maxWaitMs));
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    throttled: isGrabThrottleError(lastErr),
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  };
}

// ─── Pushed-state snapshot ───────────────────────────────────────────────────

export async function readPushedState(supabase: SupabaseClient): Promise<PushedState> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PUSHED_STATE_KEY)
    .maybeSingle();
  const raw = (data as { value?: unknown } | null)?.value;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as PushedState) : {};
}

async function writePushedState(supabase: SupabaseClient, state: PushedState): Promise<void> {
  await supabase
    .from("app_settings")
    .upsert({ key: PUSHED_STATE_KEY, value: state }, { onConflict: "key" });
}

/**
 * Record that Grab has been told `isAvailable` for one item at one merchant.
 * Read-modify-write on a single JSONB row: the reconciler runs on a cron and
 * the register writes are seconds apart, so a lost update only costs one extra
 * (idempotent) re-push on the next reconcile.
 */
export async function markPushed(
  supabase: SupabaseClient,
  merchantId: string,
  productId: string,
  isAvailable: boolean,
): Promise<void> {
  const state = await readPushedState(supabase);
  state[merchantId] = { ...(state[merchantId] ?? {}), [productId]: isAvailable };
  await writePushedState(supabase, state);
}

/**
 * Forget what we believe Grab knows about one item, so the next reconcile
 * re-pushes it. Called when an inline push fails — the DB says 86, Grab may not.
 */
export async function markUnsynced(
  supabase: SupabaseClient,
  merchantId: string,
  productId: string,
): Promise<void> {
  const state = await readPushedState(supabase);
  if (state[merchantId]?.[productId] === undefined) return;
  const next = { ...state[merchantId] };
  delete next[productId];
  state[merchantId] = next;
  await writePushedState(supabase, state);
}

// ─── Single-item sync (the shared write path) ────────────────────────────────

export type ItemSyncOutcome =
  | "pushed"
  | "throttled"
  | "error"
  | "no-merchant"
  | "grab-not-configured";

/**
 * Push ONE item's availability to the Grab merchant behind an outlet, and record
 * the outcome in the pushed-state snapshot.
 *
 * Both surfaces that write `outlet_product_availability` call this — the SUNMI
 * register (`/api/pos/availability`, keyed by loyalty outlet id) and the
 * BackOffice availability matrix (`/api/pickup/menu/availability`, keyed by the
 * pickup store slug) — so an admin closing an item and a barista closing it
 * reach Grab identically. Pass whichever key you have.
 *
 * Never throws: the DB write is the source of truth and must not be undone by a
 * Grab failure. A failure is recorded as un-synced, which is the reconciler's cue.
 */
export async function syncItemAvailabilityToGrab(
  supabase: SupabaseClient,
  outlet: { loyaltyOutletId?: string | null; storeId?: string | null },
  productId: string,
  isAvailable: boolean,
): Promise<ItemSyncOutcome> {
  try {
    // Store slug → loyalty outlet id, when that's the key we were given.
    let loyaltyOutletId = outlet.loyaltyOutletId ?? null;
    if (!loyaltyOutletId && outlet.storeId) {
      const { data: os } = await supabase
        .from("outlet_settings")
        .select("loyalty_outlet_id")
        .eq("store_id", outlet.storeId)
        .maybeSingle();
      loyaltyOutletId = (os as { loyalty_outlet_id?: string | null } | null)?.loyalty_outlet_id ?? null;
    }
    if (!loyaltyOutletId) return "no-merchant";

    const { data: outletRow } = await supabase
      .from("outlets")
      .select("grab_merchant_id")
      .eq("id", loyaltyOutletId)
      .maybeSingle();
    const merchantId = (outletRow as { grab_merchant_id?: string | null } | null)?.grab_merchant_id;
    if (!merchantId) return "no-merchant";
    if (!isGrabConfigured()) return "grab-not-configured";

    // Records must target GRAB's item id, not ours — a portal-built (self-serve)
    // menu keys items by Grab's id (e.g. "MYITE2026..."), so a record keyed by
    // our product id matches nothing and the 86 silently never reaches Grab. Use
    // products.grab_item_id when linked; fall back to our id, which is what Grab
    // echoes as the partner externalID on stores that pulled our menu.
    const { data: prod } = await supabase
      .from("products")
      .select("grab_item_id")
      .eq("id", productId)
      .maybeSingle();
    const grabItemId =
      (prod as { grab_item_id?: string | null } | null)?.grab_item_id || productId;

    const result = await pushAvailability(merchantId, [
      availabilityEntity(grabItemId, isAvailable),
    ]);
    if (result.ok) {
      await markPushed(supabase, merchantId, grabItemId, isAvailable);
      return "pushed";
    }
    // Drop it from the snapshot so reconcileGrabAvailability re-sends it.
    await markUnsynced(supabase, merchantId, grabItemId);
    console.error(
      `[grab:availability] push failed after ${result.attempts} attempt(s) ` +
        `merchant=${merchantId} item=${grabItemId}: ${result.error}`,
    );
    return result.throttled ? "throttled" : "error";
  } catch (e) {
    console.error("[grab:availability] push failed:", e);
    return "error";
  }
}

// ─── Reconciler ──────────────────────────────────────────────────────────────

export interface AvailabilityReconcileOutlet {
  merchantId: string;
  storeId: string | null;
  pending: number;
  pushed: number;
  failed: number;
  error?: string;
}

export interface AvailabilityReconcileSummary {
  skipped?: string;
  outlets: AvailabilityReconcileOutlet[];
}

/** Batch size and pacing — small enough that one throttled batch is cheap to retry. */
const BATCH_SIZE = 20;
const BATCH_GAP_MS = 1_200;
/** Wall-clock ceiling; leftovers heal on the next cron tick. */
const RUN_BUDGET_MS = 45_000;

/**
 * Re-assert per-outlet item availability on GrabFood for anything Grab isn't
 * known to have. Idempotent and diff-driven: a steady state sends zero calls.
 *
 * Runs from the Grab cron (see api/cron/grab-reconcile) — the same safety-net
 * role reconcileGrabOrders plays for orders.
 */
export async function reconcileGrabAvailability(
  supabase: SupabaseClient,
): Promise<AvailabilityReconcileSummary> {
  if (!isGrabConfigured()) return { skipped: "grab_not_configured", outlets: [] };

  const startedAt = Date.now();

  const { data: outletRows, error: outletErr } = await supabase
    .from("outlets")
    .select("id, grab_merchant_id")
    .not("grab_merchant_id", "is", null);
  if (outletErr) return { skipped: "outlet_lookup_failed", outlets: [] };

  const linked = (outletRows ?? []) as Array<{ id: string; grab_merchant_id: string | null }>;
  if (linked.length === 0) return { skipped: "no_linked_outlets", outlets: [] };

  // Grab-visible catalogue + its global availability.
  const { data: prodRows, error: prodErr } = await supabase
    .from("products")
    .select("id, is_available, visible_channels");
  if (prodErr) return { skipped: "product_lookup_failed", outlets: [] };
  const grabProducts = ((prodRows ?? []) as Array<{
    id: string;
    is_available: boolean | null;
    visible_channels: unknown;
  }>).filter((p) => isGrabVisible(p.visible_channels));

  // Loyalty outlet id → pickup store slug (the 86 table's key).
  const { data: settingRows } = await supabase
    .from("outlet_settings")
    .select("loyalty_outlet_id, store_id");
  const storeByOutlet = new Map<string, string>();
  for (const s of (settingRows ?? []) as Array<{
    loyalty_outlet_id: string | null;
    store_id: string | null;
  }>) {
    if (s.loyalty_outlet_id && s.store_id) storeByOutlet.set(s.loyalty_outlet_id, s.store_id);
  }

  const state = await readPushedState(supabase);
  const outlets: AvailabilityReconcileOutlet[] = [];
  let stateDirty = false;

  for (const outlet of linked) {
    const merchantId = outlet.grab_merchant_id;
    if (!merchantId) continue;
    const storeId = storeByOutlet.get(outlet.id) ?? null;

    // Per-outlet 86 list. No store slug = no overrides to apply (global only).
    const outletUnavailable = new Set<string>();
    if (storeId) {
      const { data: oos } = await supabase
        .from("outlet_product_availability")
        .select("product_id")
        .eq("outlet_id", storeId)
        .eq("is_available", false);
      for (const r of (oos ?? []) as Array<{ product_id: string }>) {
        outletUnavailable.add(r.product_id);
      }
    }

    const desired = new Map<string, boolean>();
    for (const p of grabProducts) {
      desired.set(
        p.id,
        desiredAvailability(p.is_available !== false, outletUnavailable.has(p.id)),
      );
    }

    const pendingIds = pendingAvailabilityIds(desired, state[merchantId]);
    const row: AvailabilityReconcileOutlet = {
      merchantId,
      storeId,
      pending: pendingIds.length,
      pushed: 0,
      failed: 0,
    };
    outlets.push(row);
    if (pendingIds.length === 0) continue;

    const merchantState = { ...(state[merchantId] ?? {}) };
    for (const batch of chunk(pendingIds, BATCH_SIZE)) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        row.error = "run_budget_exhausted";
        break;
      }
      const entities = batch.map((id) => availabilityEntity(id, desired.get(id)!));
      const result = await pushAvailability(merchantId, entities);
      if (result.ok) {
        for (const id of batch) merchantState[id] = desired.get(id)!;
        row.pushed += batch.length;
        stateDirty = true;
      } else {
        row.failed += batch.length;
        row.error = result.error;
        // A permanent error will fail identically for every later batch —
        // stop and let the next run retry rather than hammering Grab.
        if (!result.throttled) break;
      }
      await sleep(BATCH_GAP_MS);
    }
    state[merchantId] = merchantState;
  }

  if (stateDirty) await writePushedState(supabase, state);
  return { outlets };
}
