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
