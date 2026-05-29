// ==========================================
// StoreHub Product Sync — DISABLED
// ==========================================
// Products are backoffice-owned. The catalog (name, price, category,
// image, channels, featured flag, and especially modifiers +
// hidden_modifier_ids) is managed directly in the backoffice menu
// editor and is the source of truth.
//
// This sync used to pull the catalog from StoreHub and upsert the
// `products` table, which clobbered backoffice edits on every run —
// most painfully the modifier groups (#144 made those backoffice-owned)
// and the soft-hidden modifier list. It now does nothing.
//
// Kept as an exported no-op so the cron + manual sync endpoints that
// import it still compile; remove those callers if/when the StoreHub
// product pipeline is retired for good.

export async function syncProducts(
  _brandId: string,
  _storeId: string,
): Promise<{ synced: number; errors: number; disabled: true }> {
  return { synced: 0, errors: 0, disabled: true };
}
