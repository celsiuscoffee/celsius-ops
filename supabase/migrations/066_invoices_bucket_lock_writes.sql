-- C4 — Revoke anonymous WRITE access to the `invoices` and `product-images`
-- storage buckets.
--
-- Migration 20260502_storage_public_read_policies (prisma tree) created
-- `TO public` SELECT **and INSERT/UPDATE** policies on storage.objects for
-- both buckets, gated only on bucket_id. The anon key ships in every client
-- bundle, so any caller could not only READ supplier invoices / proof-of-
-- payment photos (vendor bank details) but UPLOAD arbitrary objects and —
-- worst — OVERWRITE existing invoice evidence. This drops the write policies.
--
-- Why this is safe with NO app change and no broken-image window:
--   • Uploads go through the server (apps/backoffice /api/inventory/upload,
--     behind requireAuth) using the SERVICE_ROLE key, which bypasses RLS
--     entirely — dropping the public INSERT/UPDATE policies does not touch it.
--   • The public SELECT policies are intentionally KEPT: the app displays
--     invoices/product images via public object URLs, so revoking read would
--     404 the current UI. Locking read down properly requires switching those
--     read sites to signed URLs first (mirror 063_hr_photos_private.sql +
--     lib/hr/photos.ts). Tracked as a follow-up — see the C4 note in
--     docs/codebase-review-2026-07-01.md.
--
-- IF EXISTS guards keep this idempotent and safe to re-run.

DROP POLICY IF EXISTS "invoices_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "invoices_public_update" ON storage.objects;
DROP POLICY IF EXISTS "product_images_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "product_images_public_update" ON storage.objects;
