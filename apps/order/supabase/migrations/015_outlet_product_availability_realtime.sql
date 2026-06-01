-- Enable Supabase Realtime on outlet_product_availability.
--
-- The per-outlet "86" (out-of-stock) toggle — written by the POS register
-- (long-press an item), another register, or the backoffice Availability
-- matrix — must live-update every connected register's catalog so an item
-- greys / un-greys instantly. The pos-native register subscribes to
-- postgres_changes on this table filtered by outlet_id (the store slug).
--
-- Without this, the override row still persists and is read on the next fetch,
-- but cross-register / cross-surface LIVE sync would silently not fire.
--
-- Applied to the live DB (kqdcdhpnyuwrxqhbuyfl) on 2026-06-02; this file
-- records it for repo reproducibility. Guarded so re-running is a no-op
-- (ALTER PUBLICATION ... ADD TABLE errors if the table is already a member).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'outlet_product_availability'
  ) then
    alter publication supabase_realtime add table outlet_product_availability;
  end if;
end $$;
