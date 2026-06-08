// Per-channel modifier visibility helper. Shared by POS register, customer
// pickup app, Grab menu sync, and delivery-platform menu sync so all of them
// apply the same rule when reading products.modifiers (jsonb) from the
// products table.
//
// Backward compatibility:
//   - A modifier group with no `channels` field (or an empty array) is
//     visible on every channel. Pre-channel data continues to work.
//   - A non-empty `channels` array restricts visibility to the listed
//     channels only.
//
// Channels are intentionally a small fixed set; see ModifierChannel below.

export type ModifierChannel = "pos" | "pickup" | "grab" | "foodpanda" | "dinein";

export interface ModifierOptionLike {
  id?: string;
  label?: string;
  priceDelta?: number;
  isDefault?: boolean;
  channels?: ModifierChannel[];
}

export interface ModifierGroupLike {
  id?: string;
  name?: string;
  multiSelect?: boolean;
  options?: ModifierOptionLike[];
  channels?: ModifierChannel[];
}

function visibleOnChannel(channels: ModifierChannel[] | undefined, channel: ModifierChannel): boolean {
  if (!channels || channels.length === 0) return true;
  return channels.includes(channel);
}

/** The canonical selling channels a product (or modifier) can be shown on. */
export const CHANNELS: ModifierChannel[] = ["pos", "pickup", "grab", "foodpanda", "dinein"];

/** Human labels for the channels — for the backoffice "Show on" UI. */
export const CHANNEL_LABELS: Record<ModifierChannel, string> = {
  pos: "POS",
  pickup: "Pickup",
  grab: "Grab",
  foodpanda: "FoodPanda",
  dinein: "Dine-in",
};

/** Whether a PRODUCT is visible on a channel given its `visible_channels`
 *  allow-list. Empty / missing = visible everywhere (backward-compatible); a
 *  non-empty list restricts to the listed channels. Same rule as modifiers,
 *  one level up. To hide a product everywhere use products.is_available. */
export function productVisibleOnChannel(
  visibleChannels: string[] | null | undefined,
  channel: ModifierChannel,
): boolean {
  if (!Array.isArray(visibleChannels) || visibleChannels.length === 0) return true;
  return visibleChannels.includes(channel);
}

// Filter a product's modifier groups to those visible on the given channel.
// Also drops any options that opt out of the channel (option-level
// `channels`), but options without `channels` always remain.
export function filterModifiersForChannel<T extends ModifierGroupLike>(
  groups: T[] | null | undefined,
  channel: ModifierChannel,
): T[] {
  if (!Array.isArray(groups)) return [];
  return groups
    .filter((g) => visibleOnChannel(g.channels, channel))
    .map((g) => ({
      ...g,
      options: Array.isArray(g.options)
        ? g.options.filter((o) => visibleOnChannel(o.channels, channel))
        : g.options,
    }));
}

// Drop modifier groups / options whose id is in the soft-blacklist
// (products.hidden_modifier_ids). Originally a StoreHub-sync compat layer —
// hide noisy/undesirable synced modifiers without the next sync undoing it —
// but it's the catalog's source of truth for "hidden", so EVERY customer
// surface (web order app + pickup-native + Grab/FoodPanda sync) must apply it.
// A group left with no visible options is dropped (an empty selector is a bug).
export function filterHiddenModifiers<T extends ModifierGroupLike>(
  groups: T[] | null | undefined,
  hiddenIds: string[] | null | undefined,
): T[] {
  if (!Array.isArray(groups)) return [];
  const hidden = new Set(Array.isArray(hiddenIds) ? hiddenIds : []);
  if (hidden.size === 0) return groups;
  return groups
    .filter((g) => !(g.id && hidden.has(g.id)))
    .map((g) => ({
      ...g,
      options: Array.isArray(g.options) ? g.options.filter((o) => !(o.id && hidden.has(o.id))) : g.options,
    }))
    .filter((g) => !Array.isArray(g.options) || g.options.length > 0);
}
